import { fetchJobs as ashby } from "./ashby.js";
import { fetchJobs as greenhouse } from "./greenhouse.js";
import { fetchJobs as icims } from "./icims.js";
import { fetchJobs as lever } from "./lever.js";
import { fetchJobs as workday } from "./workday.js";
import { classifyLevel } from "../classify.js";
import { parseTerm } from "../term.js";
import { regionsFor, isVagueLocation } from "../region.js";

const PROVIDERS = { ashby, greenhouse, icims, lever, workday };

/**
 * Some boards put a work arrangement in the location field and nothing else —
 * Cloudflare's Greenhouse feed says "In-Office", "Hybrid" or "Distributed" for
 * every posting, with no geography anywhere in the API. `assumeRegion` on a
 * company is the opt-in escape hatch: it applies only when a posting resolves
 * to no region at all, so genuine foreign locations are still dropped.
 */
function regionsOf(job, company, input) {
  const regions = regionsFor(input);
  if (regions.length > 0) return regions;

  // A secondary location field (Greenhouse offices) is consulted only when the
  // primary one is vague — a work arrangement or a placeholder. An unresolved
  // *real* place means the job is somewhere we do not track, and must not be
  // overridden: Epic Games lists office "Cary" on postings located in Brazil.
  const primary = input.locations ?? [];
  if (primary.every(isVagueLocation) && job.fallbackLocations?.length) {
    const fallback = regionsFor({ locations: job.fallbackLocations });
    if (fallback.length > 0) return fallback;
  }

  // Last resorts, only once the location field has produced nothing. Boards
  // that stuff a work arrangement into `location` often put the real place in
  // the title: "Software Engineer Intern (Fall 2026) - Austin, TX".
  const fromTitle = regionsFor({ locations: [job.title] });
  if (fromTitle.length > 0) return fromTitle;

  return company.assumeRegion ? [company.assumeRegion] : [];
}

export function getProvider(ats) {
  const provider = PROVIDERS[ats];
  if (!provider) {
    throw new Error(
      `unknown ats "${ats}" (expected one of: ${Object.keys(PROVIDERS).join(", ")})`,
    );
  }
  return provider;
}

/**
 * Fetch and normalize one company's postings.
 * Every provider returns records of the same shape; this adds identity fields.
 */
export async function fetchCompany(company) {
  const provider = getProvider(company.ats);
  const raw = await provider(company);

  const seen = new Set();
  const jobs = [];

  for (const job of raw) {
    if (!job.id) continue;
    const key = `${company.slug ?? company.name}:${job.id}`;
    if (seen.has(key)) continue; // some boards list a role under several offices
    seen.add(key);

    const { employmentType, locations, countries, fallbackLocations, ...rest } =
      job;
    const level = classifyLevel(job);

    // employmentType, locations and countries are classifier inputs only. The
    // feed keeps the derived values plus the display `location` string.
    jobs.push({
      ...rest,
      key,
      company: company.name,
      level,
      term: parseTerm(job.title, level),
      regions: regionsOf(job, company, { locations, countries }),
    });
  }

  return jobs;
}
