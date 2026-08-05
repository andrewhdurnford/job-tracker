import { fetchJson } from "../http.js";

const BASE = "https://api.ashbyhq.com/posting-api/job-board";

// Response: { jobs: [...], apiVersion }
export async function fetchJobs(company) {
  const data = await fetchJson(`${BASE}/${encodeURIComponent(company.slug)}`);

  if (!data || !Array.isArray(data.jobs)) {
    throw new Error("unexpected Ashby response shape (no jobs array)");
  }

  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      id: String(j.id),
      title: j.title ?? "(untitled)",
      location: locationOf(j),
      locations: allLocations(j),
      countries: allCountries(j),
      team: j.team ?? j.department ?? null,
      url: j.jobUrl ?? j.applyUrl ?? null,
      postedAt: toIso(j.publishedAt),
      // Clean enum: FullTime | Intern | Contract | PartTime | Temporary.
      employmentType: j.employmentType ?? null,
    }));
}

// The display string keeps only the primary location; region matching needs
// every one of them, or a role listed "London (+2 more)" with a New York
// secondary would be dropped as foreign.
function allLocations(j) {
  const extras = Array.isArray(j.secondaryLocations)
    ? j.secondaryLocations.map((s) => s?.location)
    : [];
  return [j.location, ...extras].filter(Boolean);
}

// Ashby carries a real postal address per location — the most trustworthy
// region signal of the three providers.
function allCountries(j) {
  const extras = Array.isArray(j.secondaryLocations) ? j.secondaryLocations : [];
  return [j, ...extras]
    .map((entry) => entry?.address?.postalAddress?.addressCountry)
    .filter(Boolean);
}

function locationOf(j) {
  const extra = Array.isArray(j.secondaryLocations) ? j.secondaryLocations.length : 0;
  const base = j.location || (j.isRemote ? "Remote" : null);
  if (!base) return null;
  return extra > 0 ? `${base} (+${extra} more)` : base;
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
