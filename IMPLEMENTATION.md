# Job Posting Tracker: Implementation Plan

Single-user job board watcher. Polls ATS APIs on a schedule, diffs against last snapshot, publishes a static site, emails on new postings.

## Stack decision

| Concern | Choice | Why |
|---|---|---|
| Language | Node 22 (already installed, `v22.22.0`) | Global `fetch`, native ESM, zero dependencies needed |
| Dependencies | None | Everything used (`fetch`, `fs`, `JSON`) is in stdlib. No `npm install` step in CI, no lockfile drift |
| Scheduler | GitHub Actions cron | Free, no server, commits results back, pairs with Pages |
| Storage | Flat JSON in repo | Snapshot diffing needs durable state; the repo *is* the database |
| Site | Static HTML + vanilla JS on GitHub Pages | Reads `data/jobs.json` via `fetch`, no build step |
| Email | Resend HTTP API, SMTP fallback | One `fetch` POST, one secret. SMTP from Actions needs a mailer dep + app password |

Rationale for zero-dep: the poller is ~300 lines of fetch/diff/write. Adding `axios`/`nodemailer`/`js-yaml` buys nothing and adds an install step to every 10-minute CI run.

## Repo layout

```
job-tracker/
├── companies.json              # config: who to track
├── data/
│   ├── jobs.json               # published feed the website reads
│   └── state.json              # internal: last seen snapshot + first-seen timestamps
├── src/
│   ├── poll.js                 # entrypoint: fetch → diff → write → notify
│   ├── providers/
│   │   ├── ashby.js
│   │   ├── greenhouse.js
│   │   ├── icims.js
│   │   ├── lever.js
│   │   ├── workday.js
│   │   └── scrape.js           # phase 2
│   ├── diff.js
│   └── notify.js               # Resend email
├── site/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── .github/workflows/poll.yml
└── IMPLEMENTATION.md
```

`data/jobs.json` and `data/state.json` are separate on purpose: `jobs.json` is the public, minimal, site-facing feed; `state.json` holds bookkeeping (raw IDs, first-seen times, per-company fetch health) that the site does not need and that would bloat the page load.

## 1. Config: `companies.json`

JSON, not YAML: no parser dependency.

```json
{
  "companies": [
    { "name": "Auctor",   "ats": "ashby",      "slug": "auctor" },
    { "name": "Stripe",   "ats": "greenhouse", "slug": "stripe" },
    { "name": "Palantir", "ats": "lever",      "slug": "palantir" },
    {
      "name": "Some Startup",
      "ats": "scrape",
      "url": "https://example.com/careers",
      "enabled": false
    }
  ]
}
```

Fields: `name` (display), `ats` (`ashby` | `greenhouse` | `lever` | `workday` | `icims` | `scrape`), `slug` (ATS board key), `url` (scrape only), `enabled` (optional, default `true`).

**Finding the slug**: it is the path segment on the hosted board:

| ATS | Board URL | Check it |
|---|---|---|
| Ashby | `jobs.ashbyhq.com/{slug}` | `curl -s "https://api.ashbyhq.com/posting-api/job-board/{slug}" \| head -c 200` |
| Greenhouse | `boards.greenhouse.io/{slug}` | `curl -s "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs" \| head -c 200` |
| Lever | `jobs.lever.co/{slug}` | `curl -s "https://api.lever.co/v0/postings/{slug}?mode=json" \| head -c 200` |
| Workday | `{tenant}.{host}.myworkdayjobs.com/{site}`, no shared board host, `tenant`/`host`/`wd5` etc/`site` all live on the company | `curl -sX POST "https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs" -H "Content-Type: application/json" -d '{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}'` |
| iCIMS/Attract | company's own domain, e.g. `careers.docusign.com/api/jobs`, no shared host at all | `curl -s "{site}/api/jobs?page=1&sortBy=relevance&descending=false&internal=false&limit=100"` |

Many companies embed the board in their own careers page; view source or check the network tab for one of those domains. Workday and iCIMS/Attract never show up in a plain `curl` of the careers page HTML; both are fetched client-side, so finding them means opening dev tools' network tab (or the app's browser tool) and watching for `myworkdayjobs.com` or a same-origin `/api/jobs` call while the page loads.

### Top-level config fields

| Field | Meaning |
|---|---|
| `defaultLevel` | Level the site shows on first visit (`intern`, `new-grad`, `experienced`). Optional; omit for everything. |
| `alertLevels` | Levels that trigger email. Optional; omit for everything. |
| `defaultTerm` | Initial intake filter, e.g. `"summer-2027"`, `"fall-2026"`, or a bare `"2027"`. Optional. |
| `regions` | Collection filter: postings outside these never enter the feed, state file, or email. |
| `maxAgeDays` | Collection filter: postings older than this are dropped at collection time. |
| `softwareOnly` | Restrict the feed to software roles (see role classification below). |
| `defaultRegion` | Site's opening view only: `us-remote` (default), `all`, `canada-remote`, or `remote`. |

Per-company optional fields: `assumeRegion` (used only when a posting resolves to no region at all, for single-country boards with useless location strings), `contentApi` (Greenhouse only; inlines `offices`/`departments` for boards with unusable location data; costly, opt-in). Workday companies carry `tenant`/`host`/`site` instead of `slug` (there is no shared board host to key off); iCIMS/Attract companies carry `site` (the company's own origin) instead of `slug`.

## 2. Providers: verified API shapes

All five endpoints were probed live; field names below are confirmed, not assumed. All are unauthenticated JSON with no CORS-safe guarantee (fetch server-side only); Workday is the one POST, the rest are GET.

### Ashby: `https://api.ashbyhq.com/posting-api/job-board/{slug}`

Response: `{ jobs: [...], apiVersion }`. Per job:

```
id                  "45cd780b-30bd-4887-b1e8-0b4858aa8e63"   (uuid, stable)
title               "Software Engineer"
department / team   "Engineering"
employmentType      "FullTime"
location            "New York"
secondaryLocations  []
publishedAt         "2026-07-21T21:07:00.158+00:00"          ← real publish date
isListed            true
isRemote            false
workplaceType       "OnSite"
jobUrl              "https://jobs.ashbyhq.com/auctor/{id}"
applyUrl            ".../application"
descriptionHtml     "<h1>…"                                  ← large, discard
```

Best of the three: gives a true `publishedAt` and an `isListed` flag. Filter to `isListed === true`.

### Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs`

Response: `{ jobs: [...], meta }`. Per job:

```
id                  7954688              (number → coerce to string)
internal_job_id     3453698
title               "Account Executive, AI Sales (Grower)"
location            { "name": "San Francisco, CA" }
absolute_url        "https://stripe.com/jobs/search?gh_jid=7954688"
first_published     "2026-06-02T08:58:57-04:00"
updated_at          "2026-07-27T11:17:30-04:00"
company_name        "Stripe"
```

No description unless `?content=true` is appended; leave it off, we do not need it. `location` is a nested object, not a string. `absolute_url` may point at the company's own site rather than the Greenhouse board.

### Lever: `https://api.lever.co/v0/postings/{slug}?mode=json`

Response: a **bare array**, not an object. Per posting:

```
id                  "ac978161-6f46-4f6b-ad9e-a258e642751c"
text                "Administrative Business Partner"        ← title lives in `text`
categories.location "London, United Kingdom"
categories.team     "Administrative"
categories.commitment "Full-time"
categories.allLocations ["London, United Kingdom"]
createdAt           1711403416463                            ← epoch ms, not ISO
workplaceType       "hybrid"
hostedUrl           "https://jobs.lever.co/palantir/{id}"
applyUrl            ".../apply"
```

Two gotchas: the title key is `text`, and `createdAt` is epoch milliseconds. Also: a dead/unknown slug returns `{"ok":false,"error":"Document not found"}` (an object, not an array), while an inactive-but-valid slug returns `[]`. Both must be handled; `[]` looks identical to "every job was just removed."

### Workday: `POST https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`

Unlike the other three, there is no shared board host: `tenant`, `host` (e.g. `wd5`, `wd12`) and `site` are all specific to the company and have to be read off their real careers page's network requests. Body: `{ appliedFacets: {}, limit, offset, searchText: "" }`; hard-capped at `limit: 20` (anything higher 400s). Response: `{ total, jobPostings: [...] }`, per posting:

```
title               "Raytracing Compiler Engineer - …"
externalPath        "/job/US-CA-Santa-Clara/…_JR2012859"   → append to {tenant}.{host}.myworkdayjobs.com/en-US/{site}
locationsText        "6 Locations"  or  "US, CA, Santa Clara"   ← aggregate text for multi-location roles, no structured breakdown at this endpoint
postedOn            "Posted Today" | "Posted Yesterday" | "Posted N Days Ago" | "Posted 30+ Days Ago"
timeType            "Full time"    ← present on some tenants (Capital One), absent on others (Nvidia)
bulletFields        ["JR2012859"]  ← requisition ID, used as the stable id
```

Three gotchas, all found by actually pulling a live board rather than trusting the docs:

- **`total` lies after page 1.** Every tenant tested (Adobe, Capital One, Nvidia, Zendesk) reports `total: 0` on every page after the first, while still returning real postings right up to the count page 1 promised. Capture `total` once, from `offset: 0`, and never again. Recomputing it from a later page silently truncates the board.
- **No absolute post date.** `postedOn` is relative text, parsed with `Posted 30+ Days Ago` deliberately mapped to 31 days ago rather than `null`, since `null` is the provider-is-broken signal the rest of the pipeline watches for (see `poll.js`'s `skipped.undated`), and a 2,000-job board is mostly `30+` entries.
- **Pagination is real HTTP cost.** A 2,000-posting board (Nvidia) is ~100 sequential requests and 30–40s per poll. Fine at 10-minute cadence, but a reason not to add every Workday-hosted megacorp indiscriminately.

### iCIMS/Attract: company's own domain, e.g. `GET {site}/api/jobs?page=1&sortBy=relevance&descending=false&internal=false&limit=100`

This is iCIMS' "Attract" career-site widget (formerly the Jibe product, which iCIMS acquired); the JSON comes from the company's own domain (`careers.docusign.com`), not a shared multi-tenant one, so config carries a full `site` origin instead of a `slug`. `limit` accepts up to 100 (500 errors). Response: `{ jobs: [...], totalCount, ... }`, each job wrapped in a `data` object:

```
data.req_id           "28977"                                   ← stable id
data.title            "Platform Software Engineer"
data.location_name    "US-Seattle-3rd"  /  "IN-Bangalore"       ← board-authored, kept as display text only
data.country_code     "US"                                      ← ISO-3166 alpha-2, always present, the cleanest region signal of any provider here
data.categories       [{ "name": "Engineering" }]
data.employment_type  "FULL_TIME"                                ← sometimes null
data.posted_date      "2026-03-17T01:35:00+0000"                ← real, absolute, no parsing needed
data.apply_url        "https://indiacareers-docusign.icims.com/jobs/28977/login"
```

Best-behaved of the five: a real ISO `posted_date` and a structured `country_code` that `region.js`'s `countryRegion()` already understood without any changes. A 300-posting board is 3 requests at `limit=100`, under 2 seconds total.

### Normalized record

Every provider maps to one shape. The site and the differ only ever see this:

```js
{
  key: "auctor:45cd780b-…",     // `${company.slug}:${id}`, globally unique
  company: "Auctor",
  id: "45cd780b-…",
  title: "Software Engineer",
  location: "New York",
  team: "Engineering",
  url: "https://jobs.ashbyhq.com/auctor/45cd780b-…",
  postedAt: "2026-07-21T21:07:00.158Z",  // ISO, null if provider gives none
  firstSeen: "2026-07-28T17:00:00.000Z"  // set by us on first sighting, never mutated
}
```

`postedAt` is the ATS's claim; `firstSeen` is ours. The site sorts and highlights by `firstSeen` because it is the only field guaranteed present and monotonic across all providers.

## 3. Poller: `src/poll.js`

Flow:

1. Read `companies.json` and `data/state.json` (missing state = first run).
2. Fetch all enabled companies **in parallel** (`Promise.allSettled`) with a 15s `AbortSignal.timeout` each.
3. Normalize each response; on any error, record the failure and **carry the previous snapshot forward untouched**.
4. Diff: new keys = present now, absent in state. Removed keys = inverse.
5. Assign `firstSeen = now` to new jobs; preserve existing `firstSeen` for jobs already known.
6. Write `data/jobs.json` (all currently-open jobs, newest `firstSeen` first) and `data/state.json`.
7. If new jobs exist and email is configured, send digest.
8. Print a summary line for the Actions log.

### Failure rules (the part that actually matters)

These are the cases that turn a job tracker into a spam machine:

- **First run bootstrap.** No `state.json` means every job is "new", potentially hundreds. Seed state, write `jobs.json`, mark all `firstSeen = now`, and **send no email**. Gate on a `bootstrap` flag in the run summary.
- **Fetch failure ≠ empty board.** If a company's request throws, times out, or returns non-200, reuse that company's previous jobs verbatim. Never let a network blip delete a company's postings and then "rediscover" them all next run as new.
- **Empty array is suspicious.** A provider returning `[]` when state has ≥5 jobs for that company is treated as a soft failure the first time: keep the old snapshot, increment `emptyStreak`. Only accept the empty result after 3 consecutive empty polls. Guards against ATS maintenance windows and Lever's `[]`-for-inactive-slug behavior.
- **Rate limiting.** These are public endpoints with no documented limits, but 144 polls/day × N companies is polite territory only up to maybe 50 companies. Send a `User-Agent` identifying the tool. If a 429 appears, treat as fetch failure and back off.
- **Removed jobs.** Drop from `jobs.json` (the site shows open roles). Record `{ key, removedAt }` in a capped `state.recentlyRemoved` list (last 100) for debugging. No email on removal.

### `data/jobs.json` shape

```json
{
  "generatedAt": "2026-07-28T17:00:00.000Z",
  "lastRunNewCount": 2,
  "companies": [
    { "name": "Auctor", "ok": true, "jobCount": 12, "error": null }
  ],
  "jobs": [ /* normalized records, newest firstSeen first */ ]
}
```

The `companies` block is what makes failures visible on the site instead of silent: a company stuck at `ok: false` for a day means its slug changed.

## 4. Scheduler: `.github/workflows/poll.yml`

```yaml
name: poll
on:
  schedule:
    - cron: "*/10 * * * *"
  workflow_dispatch:

concurrency:
  group: poll
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node src/poll.js
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          ALERT_EMAIL_TO: ${{ secrets.ALERT_EMAIL_TO }}
          ALERT_EMAIL_FROM: ${{ secrets.ALERT_EMAIL_FROM }}
      - run: |
          git config user.name "job-tracker-bot"
          git config user.email "bot@users.noreply.github.com"
          git add data/
          git diff --staged --quiet || git commit -m "chore: poll $(date -u +%FT%TZ) [skip ci]"
          git push
```

Notes:

- `concurrency` prevents two overlapping runs racing on the same commit and one losing to a non-fast-forward push.
- `git diff --staged --quiet ||` skips the commit when nothing changed; otherwise the repo gets 144 empty commits/day.
- `permissions: contents: write` is required; the default `GITHUB_TOKEN` is read-only on many org settings.
- **Cron drift is real.** GitHub Actions scheduled runs queue on shared infra; `*/10` regularly lands 5–20 minutes late, and runs can be dropped entirely during peak load. Ten minutes is a target, not a guarantee. Also: scheduled workflows are auto-disabled after 60 days of repo inactivity; the bot's own commits count as activity, so this self-heals as long as new jobs appear occasionally. Add a manual `workflow_dispatch` (above) to wake it up.
- If drift becomes intolerable, the escape hatch is a Fly.io machine or a local `launchd` timer running the same `poll.js` against the same files, since the script has no Actions-specific code.

## 5. Website: `site/`

Static page, no framework, no build. `app.js` does `fetch('../data/jobs.json')` (or `data/jobs.json` depending on Pages root) and renders.

Display per job: company, title, location, team, link, relative found-time ("3h ago").

Highlighting:

- **NEW** badge (accent background) for `firstSeen` within the last 24h.
- Subtle marker for jobs from the most recent poll specifically (`firstSeen === generatedAt` bucket).
- Header line: "Last checked 4 minutes ago · 2 new" plus a red banner listing any company where `ok: false`.

Sort: `firstSeen` desc, then company, then title.

Pages setup: Settings → Pages → deploy from branch `main`, folder `/` (root), with `index.html` at the repo root re-exporting `site/`, or simpler, put the site files at the repo root and keep `data/` alongside them. Root-level is the least-friction option since `jobs.json` must be fetchable at a stable relative path.

The nice-to-have filters (company dropdown, keyword box, location box) are ~30 lines of client-side `Array.filter` over the already-loaded array. Cheap enough to include in v1.

## 6. Email: `src/notify.js`

Resend, because it is one POST with one secret and no dependency:

```js
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: process.env.ALERT_EMAIL_FROM,   // onboarding@resend.dev works before domain verification
    to: process.env.ALERT_EMAIL_TO,
    subject: `${newJobs.length} new job${newJobs.length > 1 ? "s" : ""}`,
    html,
  }),
});
```

Rules:

- **Optional by construction.** `if (!process.env.RESEND_API_KEY) return;`: no key, no email, no error, poller still succeeds. Everything else works without it.
- Send only when `newJobs.length > 0` and not bootstrapping.
- One email per poll containing all new postings grouped by company, not one email per job.
- Email send failure is logged but must not fail the workflow step, otherwise a Resend outage blocks the data commit and the next run re-detects the same jobs as new.
- Free tier: 100 emails/day, 3000/month. Well within range for one email per *new posting event*, not per poll.
- **SMTP alternative** if Resend is undesirable: Gmail app password + `nodemailer`. Costs a dependency and an `npm ci` step in every run, and Google periodically tightens app-password access. Resend is the recommended path; Gmail SMTP is the fallback if domain/deliverability matters more than simplicity.

## 7. Phase 2: scraping fallback

For companies not on the big three. Deliberately after v1.

- Try structured data first: many careers pages embed `<script type="application/ld+json">` with schema.org `JobPosting` objects. Parse that before touching HTML.
- Next: look for an embedded JSON blob (`__NEXT_DATA__`, `window.__INITIAL_STATE__`): most modern careers pages ship the listing array in the HTML already.
- Last resort: regex/`HTMLRewriter`-style extraction per company, one adapter file each, in `src/providers/scrape.js` keyed by hostname.
- Also check for less-common ATSes before writing a custom scraper: Workable (`apply.workable.com/api/v1/widget/accounts/{slug}`), Recruitee, SmartRecruiters, and Rippling all expose similar public JSON. Adding a provider is cheaper than a scraper.
- Stability rule: scraped jobs need a synthetic stable ID. Use a hash of `title + location + url`, never the DOM position, which changes on every reorder and would fire false "new job" alerts.
- Any scrape adapter that throws is just a failed fetch: previous snapshot carries forward. Same rule as the APIs.

## Build order

1. `companies.json` + three providers + a `node src/providers/ashby.js auctor`-style manual smoke test.
2. `poll.js` diff/state/write, run twice locally, confirm second run reports 0 new.
3. Static site reading the local `jobs.json` (`python3 -m http.server`).
4. GitHub repo, push, enable Pages, add the workflow. Verify commit-back works.
5. Resend key + secrets, verify one email.
6. Filters/search on the site.
7. Scraping adapters as needed.

Steps 1–4 are the working product. 5 is optional by design. 6–7 are nice-to-haves.

## Decisions made

- **Public repo**: confirmed. Free Pages + unlimited Actions minutes, tracked-company list is public. Site files live at the repo root so `data/jobs.json` resolves at a stable relative path with no Pages build step.

## Built (v1)

Steps 1–4 and 6 of the build order are done and verified against live endpoints:

- All three providers fetch and normalize; a run against Auctor + Stripe + Palantir returned 831 jobs.
- Second run reports 0 new: the diff is stable.
- Bad slug injected mid-run: `HTTP 404 Not Found (kept 287 stale jobs)`, feed marks the company `ok: false`, no phantom removals.
- Lever threw a transient `response was not valid JSON` on one real run and the carry-forward path absorbed it with no data loss: the exact failure the design exists for.
- Deleting entries from state produced exactly 2 `NEW` rows on the next poll.

One addition beyond the original plan: a **`seeded`** flag. Jobs discovered on the first-ever run get a `firstSeen` (so ordering works) but are marked seeded, and the site neither highlights them nor claims it "found" them just now, otherwise day one is 830 green rows all claiming to be new. The feed also carries `newKeys` so the site can distinguish "new in the most recent poll" from "new in the last 24h" without clock arithmetic.

## Role-level classification

Added after v1. Every job carries `level`: `intern` | `new-grad` | `experienced`, computed at poll time in [src/classify.js](src/classify.js) and stored in the feed.

**Signal quality per ATS**, measured over 3,643 live titles:

| ATS | Structured field | Verdict |
|---|---|---|
| Ashby | `employmentType` | Clean enum: `FullTime` 1228, `Intern` 5, `Contract` 12. Trustworthy. |
| Lever | `categories.commitment` | Free text, company-authored. 15 distinct values including `Permanent`, `Hybrid Remote`, `Regular Full Time (Salary)`, and **undefined on 333 of 780**. Only `Internship` is meaningful, and even that is sometimes wrong. |
| Greenhouse | none | Title only. |

So: **title first, structured field as fallback.** A real posting titled `Risk Analyst - New Grad` carried commitment `Internship`; letting metadata win would have misfiled it.

The variant problem is mostly solved by word boundaries rather than by enumerating spellings. `\bintern\b` already rejects `Internal Audit`, `International Tax` and `Database Engine Internals`, because the following character is a word character. Same trick kills `Cooperative AI` under `\bco-?op\b`.

Rules that needed real evidence, not intuition:

- `stage` (FR) and `placement` (UK) are too collision-prone bare. `stage` is dropped entirely (`Early Stage`, `Growth Stage`, `Backstage`); `placement` only counts with a qualifier (`industrial placement`, `placement year`).
- A recruiting role for juniors is not a junior role: `Head of Early Career Recruiting` must not match. Guarded, but the guard is deliberately not applied to interns, since `Recruiting Intern` is a genuine internship.
- Ashby's `Intern` enum must not be able to override an explicit `New Grad` in the title.

Coverage over the 3,643-title corpus: 52 intern, 31 new-grad, 3,560 experienced. Spot-checking the two odd intern hits (`Expert Engineer`, `Intern III`) traced both to `leverdemo`, Lever's own demo board, not real-world noise.

[src/classify.test.js](src/classify.test.js) pins all of the above against the actual titles, run with `npm test` (Node's built-in runner, still zero dependencies).

Config surface: `defaultLevel` (site's initial filter) and `alertLevels` (which levels email). Both optional. Everything is always tracked regardless: filtering is presentation, never collection, so changing your mind later does not require re-seeding.

## Intake term parsing

Every intern/new-grad job also carries `term: { label, seasons[], year }`, parsed in [src/term.js](src/term.js).

The naive framing ("extract season and year") is the easy half. Over 6,935 live titles, **most year tokens are not intakes**: posting dates (`Marketing Analyst - 11/2025`, `Data Analyst Nov 2020`), conferences (`ICLR 2026`, `ISCA 2026`), events (`Data Center Compute, OpenHouse Savannah 2026`), internal codes (`LON - 2026 - Senior Manager Compensation`), and program years on senior roles (`Point72 Academy 2026 … for Experienced Professionals`).

Every single one of those is an `experienced` posting. So the parser refuses to run unless the job already classified as intern or new-grad. That one gate removes the entire false-positive class without a single title heuristic: the level classifier was already doing the work. Remaining guards are cheap: reject a year preceded by `/`, `-` after digits, or a month name; reject years outside `[now − 1, now + 3]`.

Design points worth keeping:

- **Label follows the posting, keys are canonical.** `Fall / Winter 2026` displays as `Fall/Winter 2026` (title order) but keys as `["winter-2026", "fall-2026"]` (chronological), so the job is reachable from either filter option and two postings writing the seasons in different orders collide correctly.
- **A year range takes its first year.** `2026-2027` is a 2026 intake.
- **Filter options are derived from the data, not hardcoded.** Intakes roll over annually; a fixed list would rot. Sorted soonest-first, bare years last within their year, plus a *No term listed* option.
- **Stale preferences degrade to "all".** A stored or configured term that no longer exists in the feed (last year's intake closed) falls back to showing everything rather than an empty page. Same for a hidden dropdown: when nothing parsed a term the control hides *and* clears, so a leftover preference cannot silently filter.

The site imports `classify.js` and `term.js` directly from the browser (both are dependency-free ESM with no Node APIs), so filtering uses the same code that produced the data. No duplicated key formats to drift.

## Location and recency filtering

Two collection-time filters, applied before the diff so a rejected posting never enters state, feed or email: region ∈ {us, canada, remote} and posted within `maxAgeDays` (30). Sorting moved from `firstSeen` to `postedAt`.

Filtering at collection rather than display was the right call here: the alternative (collect everything, filter in the browser) means the email still fires for a Bengaluru role and `jobs.json` carries 15,000 entries to render 3,700.

**Provider data was being thrown away.** The display string collapses multi-location roles to `"London (+2 more)"`, which would have dropped a job whose *second* location is New York. Providers now emit a full `locations[]`, plus `countries[]` from the structured fields I had ignored: Ashby's `address.postalAddress.addressCountry` (per location, including secondaries) and Lever's ISO-3166 `country`. Greenhouse has neither, hence the string parser.

Ordering inside [src/region.js](src/region.js) is load-bearing, and every rule came from a measured failure over 1,981 distinct location strings:

| Rule | Real string that forced it |
|---|---|
| ISO `CC-` prefix wins outright | `IN-Pune` matched IN = Indiana |
| Foreign countries before state codes | `DE-Germany-Remote` matched DE = Delaware |
| Two-letter codes must be upper-case | `In-Office` matched IN = Indiana |
| Canada before US | `Toronto, ON, CA`: CA is Canada here, California in `Palo Alto, CA` |
| Foreign *cities* after US states | `London` is the UK one, `London, KY` is not |
| Lower-case `or`/`and` split only | `Portland, OR` lost Oregon to the separator |

Remote is qualified by whatever country it names, so `Remote - UK` and `MX-Mexico-Remote` drop while bare `Remote`/`Distributed` counts. Multi-location strings union their regions: `London, UK; New York, NY` stays, since the NY option is real.

Result: 4,351 dropped as non-US/Canada, 7,289 as older than 30 days, 3,676 kept. Auditing the survivors for foreign-looking strings leaves exactly two, both genuine multi-location postings.

**Unplaceable boards.** Cloudflare's Greenhouse feed uses `location` for work arrangement (`In-Office`, `Hybrid`, `Distributed`) and the plain board API publishes no geography at all. The run log prints `most dropped by region` so this is visible rather than quietly halving a board, and reading it correctly matters because the same number means two different things. Databricks (99), Okta (80) and ClickHouse (52) are genuinely foreign postings; Cloudflare's 53 were a data defect.

Three mitigations, in increasing order of intrusiveness:

- **Greenhouse `?content=true`**, opt-in per company via `contentApi`. It returns `offices` and `departments` alongside the usual fields. Opt-in because it also inlines every job description: 4.7 MB versus 258 KB for the same board, every ten minutes. Enabled for Cloudflare (10 → 53 placed), Stripe (59 → 73), Epic Games (36 → 39).
- **A title fallback**, tried only when the location field yields nothing: `Software Engineer Intern (Fall 2026) - Austin, TX`.
- **An opt-in `assumeRegion`** per company, also only for the no-region case. Deliberately not set for Cloudflare: they hire globally, so asserting `us` would be a lie about hundreds of postings. It is only correct for single-country boards.

The subtle part is that `offices` is a **fallback, not a replacement**, gated on the primary location being *vague* rather than merely unresolved. Epic Games forced the distinction: it lists office `Cary` on postings located in `Porto Alegre, Rio Grande do Sul, Brazil`. Preferring offices outright relocated Brazilian roles to North Carolina and cut Epic's placed count from 36 to 7, a regression that only showed up because the same change was measured on three boards instead of the one it was written for.

Hence `isVagueLocation()`: `In-Office`, `Hybrid`, `N/A`, `BLANK,BLANK,Multiple Locations` are placeholders and justify consulting another field. `Bengaluru, India` is a real place we simply do not track, and must never be overridden.

## Software-role classification

Third collection filter, in [src/role.js](src/role.js), config `softwareOnly` (default true).

The naive approach (match `engineer|developer`) fails immediately. On these boards that also catches Chemical Engineer, Antenna Engineer, Avionics Test Engineer, Battery Systems Engineer, Commercial Sales Engineer, Customer Success Engineer and Architectural Designer. SpaceX alone contributes hundreds of non-software engineering titles.

Two structural findings drove the design:

**Precedence matters more than the word lists.** The same word is decisive or irrelevant depending on which rule sees it first. Every ordering rule below came from a title that the previous arrangement got wrong:

| Arrangement | Title that broke it |
|---|---|
| Exclusions before positives | `Sr. Full Stack Engineer, Manufacturing Systems` was dropped as manufacturing |
| Positives before exclusions | `Sr. Materials Engineer, AI Satellites` was kept as AI |
| One flat positive list | `Test Engineer, Oxygen` matched "test engineer" |
| GTM before all positives | `Software Engineer, GTM Platform` was dropped as sales |
| GTM after all positives | `Senior Customer Engineer — Cloudflare Developer Platform` was kept as software |

The resolution splits positives into **explicit** (`software`, `backend`, `full stack`, `ML engineer`, beats any domain in the title) and **proximity** (a software domain near a role noun, checked only after the discipline and function exclusions). GTM likewise splits into a **head** form (`customer engineer`, `sales engineer`, beats explicit) and a broad form (checked after).

**Team is a weak second signal.** Only 829 of 3,677 postings carry one (Greenhouse publishes none), so it can only rescue a genuinely generic title (`Staff Engineer II` on the Engineering team) or veto one (the same title on Hardware).

Two bugs worth recording:

- `full-?stack` silently missed every `Full Stack Engineer` in the data, since the real titles use a space. Same latent bug in `back-?end`/`front-?end`. Nothing failed loudly; the count was just quietly low.
- `intern`/`internship`/`co-op` had to become role nouns. Internships name their field without an engineering noun (`ML Research Intern` has no "engineer" in it), and were being dropped wholesale.

Result over the 15,321-posting corpus: 11,132 dropped as non-software, leaving 761 after all three filters. Auditing the survivors for non-software vocabulary leaves only titles like `Senior Staff Software Engineer, Marketing Technology`, which are correctly kept.

Judgment calls, all easy to reverse in the word lists: product management, design/UX, data *analysts*, IT/ERP administration and hardware are out; data engineers, data scientists, ML/research engineers, security engineers, SRE/DevOps and engineering leadership over software are in.

## Deploying

1. Create a **public** repo and push.
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Settings → Actions → General → Workflow permissions: **Read and write**.
4. The workflow runs on the `*/10` cron and commits `data/` back. Trigger the first run by hand from the Actions tab (`poll` → *Run workflow*).

Site lands at `https://<user>.github.io/<repo>/`.

## Email alerts (optional)

Everything works without this. To enable, add repo secrets under Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) (free tier: 100/day) |
| `ALERT_EMAIL_TO` | Your address. Comma-separate for several. |
| `ALERT_EMAIL_FROM` | Optional. Defaults to `onboarding@resend.dev`, which works before you verify a domain. |

## Data files

- `data/jobs.json` is what the site reads: all currently open roles, plus per-company health.
- `data/state.json` is bookkeeping: full snapshot, `firstSeen` timestamps, empty-response streaks, recently removed roles.

Both are committed. The repo is the database. Delete `data/` to start over: the next run re-seeds and sends no email.

## Testing

```bash
npm test
```

Node's built-in runner, zero dependencies. The suite asserts against real titles pulled from live boards, including known false positives, so changing a pattern tells you immediately what it broke.

## Still open

- Which companies beyond Auctor? Config is trivial to extend, but slugs need looking up one by one.
- Keyword filtering at the *alert* level (only email for roles matching e.g. "engineer") vs. showing everything on the site and filtering by eye. Matters once the tracked list grows: a 500-role board like Stripe's will generate daily email noise otherwise.
- No `alertTerms` config to match `alertLevels`. Deliberate: term parsing finds nothing on ~80% of cohort postings (most never state an intake), so muting email by term would silently drop real internships. The term filter stays a display control until that ratio improves.
