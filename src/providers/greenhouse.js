import { fetchJson } from "../http.js";
import { isVagueLocation } from "../region.js";

const BASE = "https://boards-api.greenhouse.io/v1/boards";

// Response: { jobs: [...], meta }. `location` is a nested object; `id` is numeric.
//
// `?content=true` additionally returns `offices` and `departments`, which some
// boards need — Cloudflare's plain `location` is a work arrangement ("Hybrid",
// "In-Office") while its offices are real places. It is opt-in per company
// because it also inlines every job description: 4.7 MB versus 258 KB for the
// same board, and this runs every ten minutes.
export async function fetchJobs(company) {
  const query = company.contentApi ? "?content=true" : "";
  const data = await fetchJson(
    `${BASE}/${encodeURIComponent(company.slug)}/jobs${query}`,
  );

  if (!data || !Array.isArray(data.jobs)) {
    throw new Error("unexpected Greenhouse response shape (no jobs array)");
  }

  return data.jobs.map((j) => ({
    id: String(j.id),
    title: j.title ?? "(untitled)",
    location: displayLocation(j),
    // One free-text string, which may itself pack several places:
    // "San Francisco, CA • New York, NY • United States".
    locations: j.location?.name ? [j.location.name] : [],
    // Offices (content=true only) are a *fallback*, never a replacement.
    // Cloudflare's offices are real places while its location field is not;
    // Epic Games is the exact reverse — every posting lists office "Cary",
    // including ones located in Brazil.
    fallbackLocations: officeNames(j),
    countries: [], // the board API exposes no structured country

    team: departmentOf(j),
    url: j.absolute_url ?? null,
    postedAt: toIso(j.first_published ?? j.updated_at),
    // Greenhouse's board API exposes no employment type — title only.
    employmentType: null,
  }));
}

function officeNames(j) {
  return Array.isArray(j.offices)
    ? j.offices.map((o) => o?.name).filter(Boolean)
    : [];
}

// Keep the board's own wording for display, but fall back to the offices when
// it is uselessly vague.
function displayLocation(j) {
  const name = j.location?.name ?? null;
  if (!isVagueLocation(name)) return name;

  const offices = officeNames(j);
  if (offices.length === 0) return name;
  const extra = offices.length - 1;
  return extra > 0 ? `${offices[0]} (+${extra} more)` : offices[0];
}

// Departments only appear with ?content=true.
function departmentOf(j) {
  if (Array.isArray(j.departments) && j.departments.length > 0) {
    return j.departments[0]?.name ?? null;
  }
  return null;
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
