import test from "node:test";
import assert from "node:assert/strict";

import { fetchJobs } from "./icims.js";

// Shape trimmed from a real Docusign `/api/jobs` response — one `data`
// wrapper per posting, `totalCount` for the whole board regardless of page.
function page(jobs, totalCount) {
  return { jobs: jobs.map((data) => ({ data })), totalCount };
}

function withMockFetch(pages, run) {
  const original = global.fetch;
  let call = 0;
  global.fetch = async () => {
    const body = pages[call++] ?? { jobs: [], totalCount: 0 };
    return { ok: true, json: async () => body };
  };
  return run().finally(() => {
    global.fetch = original;
  });
}

test("paginates until totalCount is exhausted, using page 1's count throughout", () =>
  withMockFetch(
    [
      page(
        Array.from({ length: 100 }, (_, i) => ({ req_id: `${i}`, title: `Job ${i}` })),
        150,
      ),
      page(
        Array.from({ length: 50 }, (_, i) => ({ req_id: `${100 + i}`, title: `Job ${100 + i}` })),
        150,
      ),
    ],
    async () => {
      const jobs = await fetchJobs({ site: "https://careers.example.com" });
      assert.equal(jobs.length, 150);
    },
  ));

test("normalizes location, country and employment fields", () =>
  withMockFetch(
    [
      page(
        [
          {
            req_id: "28977",
            title: "Platform Software Engineer",
            location_name: "US-Seattle-3rd",
            country_code: "US",
            categories: [{ name: "Engineering" }],
            apply_url: "https://example-careers.icims.com/jobs/28977/login",
            posted_date: "2026-03-17T01:35:00+0000",
            employment_type: "FULL_TIME",
          },
        ],
        1,
      ),
    ],
    async () => {
      const [job] = await fetchJobs({ site: "https://careers.example.com" });
      assert.equal(job.id, "28977");
      assert.equal(job.location, "US-Seattle-3rd");
      assert.deepEqual(job.countries, ["US"]);
      assert.equal(job.team, "Engineering");
      assert.equal(job.employmentType, "FULL_TIME");
      assert.equal(job.postedAt, new Date("2026-03-17T01:35:00+0000").toISOString());
    },
  ));

test("missing employment type and posted date stay null rather than guessed", () =>
  withMockFetch(
    [page([{ req_id: "1", title: "Role" }], 1)],
    async () => {
      const [job] = await fetchJobs({ site: "https://careers.example.com" });
      assert.equal(job.employmentType, null);
      assert.equal(job.postedAt, null);
      assert.deepEqual(job.countries, []);
    },
  ));
