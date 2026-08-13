// The poller's modules are dependency-free ESM, so the browser runs the exact
// same code that classified the jobs — no duplicated labels or key formats.
import { LEVEL_LABELS } from "./src/classify.js";
import { termKeys, termKeyLabel, compareTermKeys } from "./src/term.js";

const LEVEL_PREF_KEY = "job-tracker:level";
const TERM_PREF_KEY = "job-tracker:term";
const NO_TERM = "__none__";

const el = {
  status: document.getElementById("status"),
  filters: document.getElementById("filters"),
  q: document.getElementById("q"),
  level: document.getElementById("level"),
  term: document.getElementById("term"),
  count: document.getElementById("count"),
  jobs: document.getElementById("jobs"),
};

let feed = null;
let hasTerms = false;

const DATA_URL =
  "https://raw.githubusercontent.com/andrewhdurnford/job-tracker/main/data/jobs.json";

init();

async function init() {
  try {
    // Fetched straight from GitHub instead of same-origin so poll commits
    // don't force a Vercel redeploy every 10 minutes.
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    feed = await res.json();
  } catch (err) {
    el.status.textContent = `Could not load data/jobs.json — ${err.message}`;
    return;
  }

  renderHeader();
  labelLevels();
  populateTerms();
  el.level.value = savedLevel() ?? feed.defaultLevel ?? "";
  updateTermVisibility();
  el.filters.hidden = false;

  el.q.addEventListener("input", render);
  el.jobs.addEventListener("scroll", updateScrollFade);
  window.addEventListener("resize", updateScrollFade);
  // Sticky: "I only care about summer 2027 internships" survives a reload.
  el.level.addEventListener("change", () => {
    remember(LEVEL_PREF_KEY, el.level.value);
    updateTermVisibility();
    render();
  });
  el.term.addEventListener("change", () => {
    remember(TERM_PREF_KEY, el.term.value);
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
  // filters nothing useful. Leave the control hidden rather than show a dead one.
  hasTerms = counts.size > 0;
  if (!hasTerms) {
    el.term.value = "";
    return;
  }

  for (const key of [...counts.keys()].sort(compareTermKeys)) {
    el.term.append(new Option(`${termKeyLabel(key)} (${counts.get(key)})`, key));
  }
  if (untermed > 0) {
    el.term.append(new Option(`No term listed (${untermed})`, NO_TERM));
  }

  el.term.value = validTermValue(read(TERM_PREF_KEY) ?? feed.defaultTerm);
}

// Terms only exist on intern/new-grad postings, and the control was asked to
// only ever show up for the intern filter specifically.
function updateTermVisibility() {
  el.term.hidden = !hasTerms || el.level.value !== "intern";
}

// A stored or configured term may not exist in today's data (last year's
// intake closed). Falling back to "all" beats showing an empty page.
function validTermValue(value) {
  if (!value) return "";
  return [...el.term.options].some((o) => o.value === value) ? value : "";
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
}

function render() {
  const q = el.q.value.trim().toLowerCase();

  const level = el.level.value;
  const term = el.term.hidden ? "" : el.term.value;

  const visible = feed.jobs.filter((job) => {
    if (level && job.level !== level) return false;
    if (term === NO_TERM && (job.level === "experienced" || job.term)) return false;
    if (term && term !== NO_TERM && !termKeys(job.term).includes(term)) return false;
    if (
      q &&
      !String(job.title).toLowerCase().includes(q) &&
      !String(job.company ?? "").toLowerCase().includes(q)
    )
      return false;
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

  if (job.level === "new-grad") {
    li.append(textNode("span", "level", LEVEL_LABELS[job.level] ?? job.level));
  }

  const meta = [job.location, job.team].filter(Boolean).join(" · ");
  if (meta) li.append(textNode("span", "meta", meta));

  // The list is ordered by posted date, so that is what each row states.
  // firstSeen only surfaces when a board gave us no date at all.
  const when = job.postedAt
    ? shortTime(job.postedAt)
    : job.seeded
      ? "already listed"
      : shortTime(job.firstSeen);
  li.append(textNode("span", "meta", when));

  return li;
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

function shortTime(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
