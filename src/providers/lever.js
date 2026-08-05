import { fetchJson } from "../http.js";

const BASE = "https://api.lever.co/v0/postings";

// Response: a BARE ARRAY. Title lives in `text`. `createdAt` is epoch ms.
// A dead slug returns { ok: false, error: "Document not found" } instead.
export async function fetchJobs(company) {
  const data = await fetchJson(
    `${BASE}/${encodeURIComponent(company.slug)}?mode=json`,
  );

  if (!Array.isArray(data)) {
    const detail = data?.error ? `: ${data.error}` : "";
    throw new Error(`Lever returned no posting array${detail}`);
  }

  return data.map((j) => ({
    id: String(j.id),
    title: j.text ?? "(untitled)",
    location: locationOf(j),
    locations: allLocations(j),
    // ISO-3166 alpha-2, e.g. "GB" — note CA here means Canada, not California.
    countries: j.country ? [j.country] : [],
    team: j.categories?.team ?? null,
    url: j.hostedUrl ?? j.applyUrl ?? null,
    postedAt: toIso(j.createdAt),
    // Free text, company-authored: seen "Full-time", "Permanent", "Internship",
    // "Hybrid Remote", and undefined on ~40% of postings. Only "Intern*" is
    // trustworthy — see classify.js.
    employmentType: j.categories?.commitment ?? null,
  }));
}

function allLocations(j) {
  const all = j.categories?.allLocations;
  if (Array.isArray(all) && all.length > 0) return all.filter(Boolean);
  return [j.categories?.location].filter(Boolean);
}

function locationOf(j) {
  const all = j.categories?.allLocations;
  const base = j.categories?.location ?? (Array.isArray(all) ? all[0] : null);
  if (!base) return null;
  const extra = Array.isArray(all) ? Math.max(0, all.length - 1) : 0;
  return extra > 0 ? `${base} (+${extra} more)` : base;
}

// Lever gives epoch milliseconds, not an ISO string.
function toIso(value) {
  if (!value) return null;
  const d = new Date(typeof value === "number" ? value : Date.parse(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
