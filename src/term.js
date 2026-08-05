/**
 * Parse the intake term ("Summer 2027", "Fall 2026") out of a posting title.
 *
 * Built against ~6,900 live titles. The hard part is not finding years, it is
 * rejecting the ones that are not terms: posting dates ("Marketing Analyst -
 * 11/2025", "Data Analyst Nov 2020"), conferences ("ICLR 2026"), events
 * ("OpenHouse Savannah 2026") and internal codes ("LON - 2026 - Senior Manager
 * Compensation"). Every one of those is an experienced role, so the level gate
 * below removes them without any title heuristics at all.
 */

const SEASON_ALIASES = {
  summer: "summer",
  fall: "fall",
  autumn: "fall", // UK/AU spelling of the same intake
  winter: "winter",
  spring: "spring",
};

// Chronological within an academic year, used for sorting filter options.
export const SEASON_ORDER = ["winter", "spring", "summer", "fall"];

const SEASON_RE = /\b(summer|fall|autumn|winter|spring)\b/gi;
const YEAR_RE = /\b(20\d{2})\b/g;
const MONTH_BEFORE_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+$/i;
// "11/2025" and "11-2025" are posting dates, not intake years.
const NUMERIC_DATE_BEFORE_RE = /\d\s*[/-]\s*$/;

const YEARS_BACK = 1;
const YEARS_AHEAD = 3;

/**
 * @param {string} title
 * @param {"intern"|"new-grad"|"experienced"} level
 * @param {{now?: Date}} [options]
 * @returns {{label: string, seasons: string[], year: number|null}|null}
 */
export function parseTerm(title, level, { now = new Date() } = {}) {
  // Terms only mean something for intake cohorts. This single check is what
  // keeps conference names and posting dates out of the filter.
  if (level !== "intern" && level !== "new-grad") return null;

  const text = String(title ?? "");
  const seasons = findSeasons(text);
  const year = findYear(text, now);

  if (seasons.length === 0 && year === null) return null;

  return { label: formatTerm(seasons, year), seasons, year };
}

function findSeasons(text) {
  const found = [];
  for (const match of text.matchAll(SEASON_RE)) {
    const season = SEASON_ALIASES[match[1].toLowerCase()];
    if (season && !found.includes(season)) found.push(season);
  }
  // Title order, so the label reads the way the posting wrote it
  // ("Fall / Winter 2026", not "Winter/Fall 2026"). Keys are canonicalised
  // separately in termKeys.
  return found;
}

function findYear(text, now) {
  const current = now.getFullYear();
  const valid = [];

  for (const match of text.matchAll(YEAR_RE)) {
    const before = text.slice(0, match.index);
    if (MONTH_BEFORE_RE.test(before)) continue; // "Nov 2020"
    if (NUMERIC_DATE_BEFORE_RE.test(before)) continue; // "11/2025"

    const year = Number(match[1]);
    if (year < current - YEARS_BACK || year > current + YEARS_AHEAD) continue;
    valid.push(year);
  }

  if (valid.length === 0) return null;
  // "Point72 Academy 2026-2027 Investment Analyst Program" — the intake is the
  // first year of the range.
  return Math.min(...valid);
}

function formatTerm(seasons, year) {
  const label = seasons.map(capitalize).join("/");
  if (label && year) return `${label} ${year}`;
  if (label) return label;
  return String(year);
}

/**
 * Filter keys for a term. A posting spanning two seasons ("Fall / Winter 2026")
 * belongs under both, so it is reachable from either filter option.
 */
export function termKeys(term) {
  if (!term) return [];
  const { seasons, year } = term;
  if (seasons.length > 0) {
    return [...seasons]
      .sort((a, b) => SEASON_ORDER.indexOf(a) - SEASON_ORDER.indexOf(b))
      .map((s) => (year ? `${s}-${year}` : s));
  }
  return year ? [String(year)] : [];
}

/** Human label for a single filter key: "fall-2026" -> "Fall 2026". */
export function termKeyLabel(key) {
  const [season, year] = String(key).split("-");
  if (SEASON_ORDER.includes(season)) {
    return year ? `${capitalize(season)} ${year}` : capitalize(season);
  }
  return String(key);
}

/** Chronological: soonest intake first, season-less keys last within a year. */
export function compareTermKeys(a, b) {
  const pa = parseKey(a);
  const pb = parseKey(b);
  if (pa.year !== pb.year) return pa.year - pb.year;
  return pa.season - pb.season;
}

function parseKey(key) {
  const [season, year] = String(key).split("-");
  const isSeason = SEASON_ORDER.includes(season);
  return {
    year: Number(isSeason ? year : season) || Number.MAX_SAFE_INTEGER,
    // A bare year sorts after every season of that year — it is the vaguest
    // option, so it reads last. MAX_SAFE_INTEGER would make same-key
    // comparisons NaN, hence a plain sentinel index.
    season: isSeason ? SEASON_ORDER.indexOf(season) : SEASON_ORDER.length,
  };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
