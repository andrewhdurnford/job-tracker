// The poller's modules are dependency-free ESM, so the browser runs the exact
// same code that classified the jobs — no duplicated labels or key formats.
import { LEVEL_LABELS } from "./src/classify.js";
import { termKeys, termKeyLabel, compareTermKeys } from "./src/term.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const LEVEL_PREF_KEY = "job-tracker:level";
const TERM_PREF_KEY = "job-tracker:term";
const REGION_PREF_KEY = "job-tracker:region";
const NO_TERM = "__none__";

// The poller already dropped everything outside these three, so this is only
// about how much of what remains you want to see.
const REGION_SETS = {
  "us-remote": ["us", "remote"],
  all: ["us", "canada", "remote"],
  "canada-remote": ["canada", "remote"],
  remote: ["remote"],
};

const el = {
  status: document.getElementById("status"),
  filters: document.getElementById("filters"),
  q: document.getElementById("q"),
  level: document.getElementById("level"),
  region: document.getElementById("region"),
  term: document.getElementById("term"),
  company: document.getElementById("company"),
  location: document.getElementById("location"),
  recent: document.getElementById("recent"),
  reset: document.getElementById("reset"),
  count: document.getElementById("count"),
  jobs: document.getElementById("jobs"),
  footer: document.getElementById("companies-footer"),
};

let feed = null;
let newKeys = new Set();

init();

async function init() {
  try {
    // Cache-bust: GitHub Pages serves jobs.json with a long-ish cache header.
    const res = await fetch(`data/jobs.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    feed = await res.json();
  } catch (err) {
    el.status.textContent = `Could not load data/jobs.json — ${err.message}`;
    return;
  }

  newKeys = new Set(feed.newKeys ?? []);
  renderHeader();
  populateCompanies();
  labelLevels();
  labelRegions();
  populateTerms();
  el.level.value = savedLevel() ?? feed.defaultLevel ?? "";
  el.region.value =
    read(REGION_PREF_KEY) ?? (feed.defaultRegion in REGION_SETS ? feed.defaultRegion : "us-remote");
  el.filters.hidden = false;

  for (const node of [el.q, el.location]) node.addEventListener("input", render);
  el.company.addEventListener("change", render);
  el.recent.addEventListener("change", render);
  el.jobs.addEventListener("scroll", updateScrollFade);
  window.addEventListener("resize", updateScrollFade);
  // Sticky: "I only care about summer 2027 internships" survives a reload.
  el.level.addEventListener("change", () => {
    remember(LEVEL_PREF_KEY, el.level.value);
    render();
  });
  el.term.addEventListener("change", () => {
    remember(TERM_PREF_KEY, el.term.value);
    render();
  });
  el.region.addEventListener("change", () => {
    remember(REGION_PREF_KEY, el.region.value);
    render();
  });
  el.reset.addEventListener("click", () => {
    el.q.value = "";
    el.location.value = "";
    el.company.value = "";
    el.recent.checked = false;
    el.level.value = feed.defaultLevel ?? "";
    el.term.value = validTermValue(feed.defaultTerm);
    el.region.value =
      feed.defaultRegion in REGION_SETS ? feed.defaultRegion : "us-remote";
    forget(LEVEL_PREF_KEY);
    forget(TERM_PREF_KEY);
    forget(REGION_PREF_KEY);
    render();
  });

  render();
}

function savedLevel() {
  return read(LEVEL_PREF_KEY);
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / storage disabled — filtering still works
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function forget(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// Term options come from the data, not a fixed list — intakes move every year.
function populateTerms() {
  const counts = new Map();
  let untermed = 0;

  for (const job of feed.jobs) {
    if (job.level === "experienced") continue; // terms only exist for cohorts
    if (!job.term) {
      untermed += 1;
      continue;
    }
    for (const key of termKeys(job.term)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  // Nothing parsed a term: the only choice would be "no term listed", which
  // filters nothing useful. Hide the control rather than show a dead one.
  if (counts.size === 0) {
    el.term.hidden = true;
    el.term.value = "";
    return;
  }

  for (const key of [...counts.keys()].sort(compareTermKeys)) {
    el.term.append(new Option(`${termKeyLabel(key)} (${counts.get(key)})`, key));
  }
  if (untermed > 0) {
    el.term.append(new Option(`No term listed (${untermed})`, NO_TERM));
  }

  el.term.hidden = false;
  el.term.value = validTermValue(read(TERM_PREF_KEY) ?? feed.defaultTerm);
}

// A stored or configured term may not exist in today's data (last year's
// intake closed). Falling back to "all" beats showing an empty page.
function validTermValue(value) {
  if (!value) return "";
  return [...el.term.options].some((o) => o.value === value) ? value : "";
}

function labelRegions() {
  for (const option of el.region.options) {
    const allowed = REGION_SETS[option.value] ?? [];
    const n = feed.jobs.filter((j) =>
      (j.regions ?? []).some((r) => allowed.includes(r)),
    ).length;
    option.textContent = `${option.textContent} (${n})`;
  }
}

// Put counts on the options so it is obvious when a filter would empty the page.
function labelLevels() {
  const counts = feed.levelCounts ?? {};
  for (const option of el.level.options) {
    if (!option.value) continue;
    const n = counts[option.value];
    if (typeof n === "number") option.textContent = `${option.textContent} (${n})`;
  }
}

function renderHeader() {
  const checked = relativeTime(feed.generatedAt);
  const n = feed.lastRunNewCount ?? 0;
  el.status.innerHTML =
    `Last checked ${checked} · ${feed.jobs.length} open roles · ` +
    (n > 0 ? `<strong>${n} new this poll</strong>` : "no new roles this poll");

  const total = feed.companies?.length ?? 0;
  const ok = (feed.companies ?? []).filter((c) => c.ok).length;
  const window = feed.maxAgeDays ? ` Showing roles posted in the last ${feed.maxAgeDays} days, US/Canada/remote only.` : "";
  el.footer.textContent = `Tracking ${total} compan${total === 1 ? "y" : "ies"} (${ok} healthy). Data refreshes every ~10 minutes.${window}`;
}

function populateCompanies() {
  const names = [...new Set(feed.jobs.map((j) => j.company))].sort();
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    el.company.append(opt);
  }
}

function render() {
  const q = el.q.value.trim().toLowerCase();
  const loc = el.location.value.trim().toLowerCase();
  const company = el.company.value;

  const level = el.level.value;
  const term = el.term.hidden ? "" : el.term.value;
  const allowedRegions = REGION_SETS[el.region.value] ?? REGION_SETS["us-remote"];

  const visible = feed.jobs.filter((job) => {
    if (!(job.regions ?? []).some((r) => allowedRegions.includes(r))) return false;
    if (level && job.level !== level) return false;
    if (term === NO_TERM && (job.level === "experienced" || job.term)) return false;
    if (term && term !== NO_TERM && !termKeys(job.term).includes(term)) return false;
    if (company && job.company !== company) return false;
    if (
      q &&
      !String(job.title).toLowerCase().includes(q) &&
      !String(job.company ?? "").toLowerCase().includes(q)
    )
      return false;
    if (loc && !String(job.location ?? "").toLowerCase().includes(loc)) return false;
    if (el.recent.checked && !isFresh(job)) return false;
    return true;
  });

  el.count.textContent =
    visible.length === feed.jobs.length
      ? `${visible.length} roles`
      : `${visible.length} of ${feed.jobs.length} roles`;

  el.jobs.replaceChildren(
    ...(visible.length === 0
      ? [textNode("li", "empty", "No roles match those filters.")]
      : visible.map(renderJob)),
  );

  updateScrollFade();
}

// Only fade an edge when there's actually more list to scroll past it —
// resting at the top must show the first row at full opacity.
function updateScrollFade() {
  const atTop = el.jobs.scrollTop <= 0;
  const atBottom = el.jobs.scrollTop + el.jobs.clientHeight >= el.jobs.scrollHeight - 1;
  el.jobs.style.setProperty("--fade-top", atTop ? "0px" : "28px");
  el.jobs.style.setProperty("--fade-bottom", atBottom ? "0px" : "28px");
}

function renderJob(job) {
  const li = document.createElement("li");
  const fresh = isFresh(job);
  li.className = "job";

  li.append(textNode("span", "company", job.company));

  const title = document.createElement("a");
  title.className = "title";
  title.textContent = job.title;
  if (job.url) {
    title.href = job.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
  }
  li.append(title);

  if (newKeys.has(job.key) || fresh) {
    li.append(textNode("span", "badge", "new"));
  }

  if (job.level === "new-grad") {
    li.append(textNode("span", "level", LEVEL_LABELS[job.level] ?? job.level));
  }
  if (job.term) li.append(textNode("span", "level term", job.term.label));

  const meta = [job.location, job.team].filter(Boolean).join(" · ");
  if (meta) li.append(textNode("span", "meta", meta));

  // The list is ordered by posted date, so that is what each row states.
  // firstSeen only surfaces when a board gave us no date at all.
  const when = job.postedAt
    ? `posted ${relativeTime(job.postedAt)}`
    : job.seeded
      ? "already listed"
      : `found ${relativeTime(job.firstSeen)}`;
  li.append(textNode("span", "meta", when));

  return li;
}

// Jobs found in the first-ever poll carry `seeded` — they exist, but they were
// never "discovered", so they must not light up the whole board on day one.
function isFresh(job) {
  return !job.seeded && Date.now() - Date.parse(job.firstSeen) < DAY_MS;
}

function textNode(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function relativeTime(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
