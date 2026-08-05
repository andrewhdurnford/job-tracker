/**
 * Diff a freshly fetched job list against the previous snapshot for one company.
 *
 * `previousJobs` is a { key -> record } map from state; records already carry a
 * `firstSeen` we must preserve. Returns the merged map plus the added/removed
 * records. Pure — no IO, no clock beyond the `now` passed in.
 *
 * `seeded` marks jobs discovered on the very first run: they get a firstSeen so
 * ordering works, but they are not genuinely "new" and must not be highlighted.
 */
export function diffCompany(previousJobs, fetchedJobs, now, { seeded = false } = {}) {
  const merged = {};
  const added = [];
  const removed = [];

  for (const job of fetchedJobs) {
    const prior = previousJobs[job.key];
    if (prior) {
      // Keep the original firstSeen (and seeded flag); refresh everything else
      // so title/location edits on the ATS show up.
      merged[job.key] = { ...job, firstSeen: prior.firstSeen };
      if (prior.seeded) merged[job.key].seeded = true;
    } else {
      const record = { ...job, firstSeen: now };
      if (seeded) record.seeded = true;
      merged[job.key] = record;
      added.push(record);
    }
  }

  for (const [key, job] of Object.entries(previousJobs)) {
    if (!merged[key]) removed.push({ ...job, removedAt: now });
  }

  return { jobs: merged, added, removed };
}

/**
 * Newest first by the date the company posted the role, falling back to when
 * we first saw it. Posted date is what you actually want to scan by; firstSeen
 * only breaks ties (and covers the theoretical case of a board with no dates).
 */
export function sortJobs(jobs) {
  return [...jobs].sort((a, b) => {
    const at = a.postedAt ?? a.firstSeen;
    const bt = b.postedAt ?? b.firstSeen;
    if (at !== bt) return at < bt ? 1 : -1;
    if (a.company !== b.company) return a.company < b.company ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  });
}
