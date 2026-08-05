import { fetchJson } from "../http.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 50; // safety cap (5,000 postings) against a runaway totalCount

// This is iCIMS' "Attract" career-site widget (formerly the Jibe product,
// which iCIMS acquired) — a JSON API served from the company's OWN domain
// rather than a shared multi-tenant one, which is why `company.site` is a
// full origin rather than a slug. Response: { jobs: [...], totalCount }, each
// job wrapped in a `data` object.
function pageUrl(company, page) {
  const base = company.site.replace(/\/$/, "");
  return `${base}/api/jobs?page=${page}&sortBy=relevance&descending=false&internal=false&limit=${PAGE_SIZE}`;
}

export async function fetchJobs(company) {
  const jobs = [];
  let total = Infinity;

  for (let page = 1; (page - 1) * PAGE_SIZE < total && page <= MAX_PAGES; page++) {
    const data = await fetchJson(pageUrl(company, page));

    if (!data || !Array.isArray(data.jobs)) {
      throw new Error("unexpected iCIMS/Attract response shape (no jobs array)");
    }

    total = data.totalCount ?? data.jobs.length;
    for (const j of data.jobs) jobs.push(normalize(j.data ?? {}));
  }

  return jobs;
}

function normalize(d) {
  return {
    id: d.req_id ?? null,
    title: d.title ?? "(untitled)",
    // "US-Seattle-3rd", "IN-Bangalore", "BR-Remote" — country code, then the
    // rest board-authored. Kept as-is; the leading code is what region
    // matching actually relies on, via `countries` below.
    location: d.location_name ?? null,
    locations: d.location_name ? [d.location_name] : [],
    // ISO-3166 alpha-2, always present on every posting seen so far — the
    // most reliable region signal of any provider in this codebase.
    countries: d.country_code ? [d.country_code] : [],
    team: d.categories?.[0]?.name ?? null,
    url: d.apply_url ?? null,
    postedAt: toIso(d.posted_date),
    employmentType: d.employment_type ?? null,
  };
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
