import { postJson } from "../http.js";

const PAGE_SIZE = 20; // hard cap enforced by Workday's cxs API; larger limits 400
const MAX_PAGES = 150; // safety cap (3,000 postings) against a runaway total

// Response: { total, jobPostings: [...] }. Workday's public "cxs" endpoint has
// no auth and no per-tenant discovery — the tenant, host (e.g. "wd5") and site
// name must be read off the real careers page (usually visible in the iframe
// src or the page's own network requests) and stored on the company.
function boardUrl(company) {
  return `https://${company.tenant}.${company.host}.myworkdayjobs.com/wday/cxs/${company.tenant}/${company.site}/jobs`;
}

export async function fetchJobs(company) {
  const jobs = [];
  let total = Infinity;

  for (let page = 0; page * PAGE_SIZE < total && page < MAX_PAGES; page++) {
    const data = await postJson(boardUrl(company), {
      appliedFacets: {},
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      searchText: "",
    });

    if (!data || !Array.isArray(data.jobPostings)) {
      throw new Error("unexpected Workday response shape (no jobPostings array)");
    }

    // `total` is only trustworthy on the very first page — every tenant
    // tested reports 0 on every page after that, even mid-board, while still
    // returning real postings right up to (and stopping exactly at) the
    // count the first page promised.
    if (page === 0) total = data.total ?? data.jobPostings.length;
    for (const j of data.jobPostings) jobs.push(normalize(j, company));
  }

  return jobs;
}

function normalize(j, company) {
  return {
    id: j.bulletFields?.[0] ?? j.externalPath,
    title: j.title ?? "(untitled)",
    // The list endpoint gives one string, which for a role open in several
    // places is an aggregate like "6 Locations" rather than the places
    // themselves — Workday only exposes the actual list on a per-job detail
    // call, which isn't worth one extra request per posting on boards with
    // thousands of them. Those postings fall out during region matching
    // rather than being mismatched to the wrong one.
    location: j.locationsText ?? null,
    locations: j.locationsText ? [j.locationsText] : [],
    countries: [],
    team: null, // not exposed per-posting, only as board-wide facet counts
    url: `https://${company.tenant}.${company.host}.myworkdayjobs.com/en-US/${company.site}${j.externalPath}`,
    postedAt: toIso(j.postedOn),
    // Present on some tenants (e.g. "Full time") and absent on others.
    employmentType: j.timeType ?? null,
  };
}

// "Posted Today" | "Posted Yesterday" | "Posted N Days Ago" | "Posted 30+ Days
// Ago" — Workday never gives an absolute date on the list endpoint. The "30+"
// bucket is deliberately mapped past the default 30-day cutoff rather than
// left null: null is reserved (see poll.js) for a provider that stops sending
// dates at all, and a board with thousands of postings would drown that
// signal in false positives every single run.
export function toIso(postedOn) {
  const text = String(postedOn ?? "").trim();
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86_400_000).toISOString();

  if (/^Posted Today$/i.test(text)) return daysAgo(0);
  if (/^Posted Yesterday$/i.test(text)) return daysAgo(1);

  const match = text.match(/^Posted (\d+) Days? Ago$/i);
  if (match) return daysAgo(Number(match[1]));

  if (/^Posted 30\+ Days Ago$/i.test(text)) return daysAgo(31);

  return null;
}
