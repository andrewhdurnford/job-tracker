import { fetchCompany } from "./providers/index.js";
import { diffCompany, sortJobs } from "./diff.js";
import { LEVELS } from "./classify.js";
import { REGIONS } from "./region.js";
import { isSoftwareRole } from "./role.js";

// Postings older than this are not collected at all.
const DEFAULT_MAX_AGE_DAYS = 30;

// An empty board is treated as a soft failure until this many polls agree.
// Guards against ATS maintenance windows and Lever's []-for-inactive-slug.
const EMPTY_STREAK_TOLERANCE = 3;
const EMPTY_GUARD_MIN_JOBS = 5;
const RECENTLY_REMOVED_CAP = 100;

async function fetchCompanyWithRetry(company) {
  try {
    return await fetchCompany(company);
  } catch (err) {
    return await fetchCompany(company);
  }
}

/**
 * Pure(ish) polling core: no filesystem or git I/O, so it can run the same
 * way from a local process (fs-backed) or a serverless function (GitHub
 * Contents API-backed). `now` must be passed in rather than read at module
 * load — a warm serverless container would otherwise reuse a stale value
 * across invocations.
 */
export async function runPoll(config, previousState, now) {
  const companies = (config.companies ?? []).filter((c) => c.enabled !== false);

  // Optional: restrict which levels trigger email, and which level the site
  // shows on first visit. Everything is still tracked either way.
  const alertLevels = Array.isArray(config.alertLevels) ? config.alertLevels : null;
  const defaultLevel = config.defaultLevel ?? null;
  const defaultTerm = config.defaultTerm ?? null;
  const defaultRegion = config.defaultRegion ?? "us-remote";
  assertLevels(alertLevels, "alertLevels");
  assertLevels(defaultLevel ? [defaultLevel] : null, "defaultLevel");
  assertTermKey(defaultTerm);

  // Collection filters: postings outside these never enter the feed at all.
  const regions = Array.isArray(config.regions) ? config.regions : REGIONS;
  const maxAgeDays = config.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const softwareOnly = config.softwareOnly !== false;
  assertRegions(regions);
  assertRegions(companies.map((c) => c.assumeRegion).filter(Boolean));
  const cutoff = new Date(Date.parse(now) - maxAgeDays * 86_400_000).toISOString();
  const skipped = { old: 0, region: 0, undated: 0, role: 0, byCompany: new Map() };

  if (companies.length === 0) {
    throw new Error("no enabled companies in companies.json — nothing to do");
  }

  const bootstrap = previousState === null;
  const state = previousState ?? {
    version: 1,
    bootstrappedAt: now,
    lastRun: null,
    companies: {},
    recentlyRemoved: [],
  };

  const settled = await Promise.allSettled(companies.map(fetchCompanyWithRetry));

  const allNew = [];
  const allRemoved = [];
  const summary = [];

  for (const [i, company] of companies.entries()) {
    const prev = state.companies[company.name] ?? {
      jobs: {},
      emptyStreak: 0,
      lastOkAt: null,
      lastError: null,
    };
    const priorCount = Object.keys(prev.jobs).length;
    const result = settled[i];

    // --- Fetch failed: carry the previous snapshot forward untouched. -------
    if (result.status === "rejected") {
      state.companies[company.name] = {
        ...prev,
        lastError: String(result.reason?.message ?? result.reason),
      };
      summary.push({
        name: company.name,
        ok: false,
        jobCount: priorCount,
        error: state.companies[company.name].lastError,
        stale: true,
      });
      continue;
    }

    const fetched = result.value.filter((job) =>
      keepJob(job, { cutoff, regions, softwareOnly, skipped }),
    );

    // --- Suspiciously empty: also carry forward, but count the streak. ------
    const suspiciouslyEmpty =
      fetched.length === 0 &&
      priorCount >= EMPTY_GUARD_MIN_JOBS &&
      prev.emptyStreak < EMPTY_STREAK_TOLERANCE - 1;

    if (suspiciouslyEmpty) {
      const streak = prev.emptyStreak + 1;
      state.companies[company.name] = {
        ...prev,
        emptyStreak: streak,
        lastError: `board returned 0 jobs (streak ${streak}/${EMPTY_STREAK_TOLERANCE}) — keeping last snapshot`,
      };
      summary.push({
        name: company.name,
        ok: false,
        jobCount: priorCount,
        error: state.companies[company.name].lastError,
        stale: true,
      });
      continue;
    }

    // --- Good fetch: diff and accept. ---------------------------------------
    const { jobs, added, removed } = diffCompany(prev.jobs, fetched, now, {
      seeded: bootstrap,
    });

    state.companies[company.name] = {
      jobs,
      emptyStreak: fetched.length === 0 ? prev.emptyStreak + 1 : 0,
      lastOkAt: now,
      lastError: null,
    };

    allNew.push(...added);
    allRemoved.push(...removed);
    summary.push({
      name: company.name,
      ok: true,
      jobCount: fetched.length,
      error: null,
      stale: false,
    });
  }

  // Drop companies removed from the config so they stop appearing in the feed.
  const tracked = new Set(companies.map((c) => c.name));
  for (const name of Object.keys(state.companies)) {
    if (!tracked.has(name)) delete state.companies[name];
  }

  if (allRemoved.length > 0) {
    state.recentlyRemoved = [
      ...allRemoved.map((j) => ({
        key: j.key,
        company: j.company,
        title: j.title,
        removedAt: j.removedAt,
      })),
      ...(state.recentlyRemoved ?? []),
    ].slice(0, RECENTLY_REMOVED_CAP);
  }

  state.lastRun = now;

  const jobs = sortJobs(
    Object.values(state.companies).flatMap((c) => Object.values(c.jobs)),
  );

  const feed = {
    generatedAt: now,
    bootstrap,
    lastRunNewCount: bootstrap ? 0 : allNew.length,
    newKeys: bootstrap ? [] : allNew.map((j) => j.key),
    defaultLevel,
    defaultTerm,
    defaultRegion,
    maxAgeDays,
    levelCounts: countLevels(jobs),
    companies: summary,
    jobs,
  };

  const alertable = alertLevels ? allNew.filter((j) => alertLevels.includes(j.level)) : allNew;

  return {
    state,
    feed,
    jobs,
    allNew,
    allRemoved,
    alertable,
    summary,
    skipped,
    bootstrap,
    maxAgeDays,
  };
}

function assertLevels(values, field) {
  if (!values) return;
  for (const value of values) {
    if (!LEVELS.includes(value)) {
      throw new Error(
        `companies.json: ${field} has unknown level "${value}" (expected: ${LEVELS.join(", ")})`,
      );
    }
  }
}

/**
 * Collection filter. A posting that fails this never reaches the feed, the
 * state file or the email — it is as if the board never listed it.
 */
function keepJob(job, { cutoff, regions, softwareOnly, skipped }) {
  if (softwareOnly && !isSoftwareRole(job)) {
    skipped.role += 1;
    return false;
  }
  if (!job.regions?.some((r) => regions.includes(r))) {
    skipped.region += 1;
    skipped.byCompany.set(
      job.company,
      (skipped.byCompany.get(job.company) ?? 0) + 1,
    );
    return false;
  }
  if (!job.postedAt) {
    // No board does this today (0 of 15,321). Counted rather than silently
    // kept, so a provider that stops sending dates is visible immediately.
    skipped.undated += 1;
    return false;
  }
  if (job.postedAt < cutoff) {
    skipped.old += 1;
    return false;
  }
  return true;
}

function assertRegions(values) {
  for (const value of values) {
    if (!REGIONS.includes(value)) {
      throw new Error(
        `companies.json: regions has unknown value "${value}" (expected: ${REGIONS.join(", ")})`,
      );
    }
  }
}

// Matches the keys produced by termKeys(): "summer-2027", "fall", "2027".
const TERM_KEY_RE = /^(?:winter|spring|summer|fall)(?:-20\d{2})?$|^20\d{2}$/;

function assertTermKey(value) {
  if (value && !TERM_KEY_RE.test(value)) {
    throw new Error(
      `companies.json: defaultTerm "${value}" is not a term key (e.g. "summer-2027", "fall-2026", "2027")`,
    );
  }
}

export function countLevels(jobs) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const job of jobs) {
    if (job.level in counts) counts[job.level] += 1;
  }
  return counts;
}

export function report({
  bootstrap,
  jobs,
  allNew,
  allRemoved,
  summary,
  mail,
  muted,
  skipped,
  maxAgeDays,
  log = console.log,
  warn = console.warn,
}) {
  const failed = summary.filter((s) => !s.ok);
  const counts = countLevels(jobs);

  if (bootstrap) {
    log(`bootstrap: seeded ${jobs.length} jobs, no email sent`);
  } else {
    log(`${jobs.length} open jobs · ${allNew.length} new · ${allRemoved.length} removed`);
    for (const job of allNew) {
      log(
        `  NEW  [${job.level}] ${job.company} — ${job.title}${job.location ? ` (${job.location})` : ""}`,
      );
    }
  }

  log(
    `filtered out: ${skipped.role} non-software · ${skipped.region} outside regions · ${skipped.old} older than ${maxAgeDays}d` +
      (skipped.undated > 0 ? ` · ${skipped.undated} with no posted date` : ""),
  );
  // A board whose location field is unparseable shows up here as an outlier;
  // that is the signal to set assumeRegion for it.
  const worst = [...skipped.byCompany.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (worst.length > 0) {
    log(`  most dropped by region: ${worst.map(([name, n]) => `${name} ${n}`).join(" · ")}`);
  }
  log(
    `levels: ${counts.intern} intern · ${counts["new-grad"]} new-grad · ${counts.experienced} experienced`,
  );

  const terms = new Map();
  let untermed = 0;
  for (const job of jobs) {
    if (job.level === "experienced") continue;
    if (job.term) terms.set(job.term.label, (terms.get(job.term.label) ?? 0) + 1);
    else untermed += 1;
  }
  if (terms.size > 0 || untermed > 0) {
    const parts = [...terms.entries()].map(([label, n]) => `${label} ${n}`);
    if (untermed > 0) parts.push(`no term ${untermed}`);
    log(`terms: ${parts.join(" · ")}`);
  }
  if (!bootstrap && muted > 0) {
    log(`  ${muted} new job(s) muted by alertLevels`);
  }

  for (const s of failed) {
    warn(`  WARN ${s.name}: ${s.error} (kept ${s.jobCount} stale jobs)`);
  }

  log(`email: ${mail.sent ? `sent (${mail.count})` : `skipped — ${mail.reason}`}`);
}
