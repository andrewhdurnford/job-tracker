# Job Tracker

Polls company ATS boards every ~10 minutes, diffs against the last snapshot, publishes a static site, and emails when new roles appear.

Zero dependencies — Node 20+ and nothing else. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the design and the verified API shapes.

## Run it locally

```bash
node src/poll.js
```

First run seeds `data/state.json` and sends no email (otherwise the whole board arrives as "new"). Every run after that reports only genuine additions.

View the site:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Adding companies

Edit `companies.json`:

```json
{
  "defaultLevel": "intern",
  "alertLevels": ["intern", "new-grad"],
  "companies": [
    { "name": "Auctor", "ats": "ashby", "slug": "auctor" },
    { "name": "Stripe", "ats": "greenhouse", "slug": "stripe" },
    { "name": "Palantir", "ats": "lever", "slug": "palantir" }
  ]
}
```

`ats` is one of `ashby`, `greenhouse`, `lever`. Add `"enabled": false` to pause one without deleting it.

`defaultLevel` sets which level the site shows on first visit; `alertLevels` limits which levels trigger email. Both are optional — omit them for everything. Levels are `intern`, `new-grad`, `experienced`; an unknown value fails the run loudly rather than silently matching nothing.

`defaultTerm` (also optional) sets the initial intake filter, e.g. `"summer-2027"`, `"fall-2026"`, or a bare `"2027"`.

`regions`, `maxAgeDays` and `softwareOnly` are **collection** filters — anything failing them never enters the feed, the state file or the email. `defaultRegion` is just the site's opening view: `us-remote` (default), `all`, `canada-remote`, or `remote`.

A company may also carry `"assumeRegion": "us"`, used **only** when a posting resolves to no region at all. Set it for boards that are single-country but publish useless location strings; leave it off for global companies, where guessing would be wrong.

**Finding the slug** — it is the path segment on the hosted board:

| ATS | Board URL | Check it |
|---|---|---|
| Ashby | `jobs.ashbyhq.com/{slug}` | `curl -s "https://api.ashbyhq.com/posting-api/job-board/{slug}" \| head -c 200` |
| Greenhouse | `boards.greenhouse.io/{slug}` | `curl -s "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs" \| head -c 200` |
| Lever | `jobs.lever.co/{slug}` | `curl -s "https://api.lever.co/v0/postings/{slug}?mode=json" \| head -c 200` |

Many companies embed the board in their own careers page — view source or check the network tab for one of those three domains.

Removing a company from the config drops its jobs from the site on the next poll.

## Role levels

Every posting is classified `intern`, `new-grad`, or `experienced` at poll time by [src/classify.js](src/classify.js). The site has a level dropdown (your choice sticks across reloads via localStorage; **Reset** returns it to `defaultLevel`).

Classification uses the title first, then the ATS employment-type field. Title wins on conflict: a real Lever posting titled `Risk Analyst - New Grad` carried commitment `"Internship"`, and company-authored commitment values in the wild include `"Permanent"`, `"Hybrid Remote"` and `"Regular Full Time (Salary)"`. Ashby's `employmentType` is a clean enum and is trusted when the title says nothing; Greenhouse exposes no such field at all.

The patterns were built against ~3,600 live titles. Word boundaries do most of the work — `\bintern\b` rejects `Internal Audit Lead`, `Director, International Operations` and `Database Engine Internals` for free, and `\bco-?op\b` rejects `Software Engineer, Cooperative AI`. `stage` (French for internship) is deliberately absent: it collides with `Account Executive, Early Stage` and `Head of Backstage Marketing`.

Caught as internships: `Software Engineer, Internship`, `Software Engineer Intern (Fall 2026)`, `Machine Learning Intern/Co-op`, `Engineering Intern`, `Intern III`, `Praktikum`, `Werkstudent`, `Summer Analyst`, `industrial placement`.

Caught as new grad: `New Grad`, `University Hire`, `Campus Hire`, `Early Career`, `Entry Level`, `Graduate Program`, `Apprentice`, `Rotational Program`. A role that *recruits* juniors is not a junior role — `Head of Early Career Recruiting` stays experienced, while `Recruiting Intern` is still an intern.

## Software roles only

The feed contains software roles only. Classification is [src/role.js](src/role.js); set `"softwareOnly": false` in `companies.json` to collect everything instead.

"Engineer" in a title is nearly worthless as a signal — on these same boards it also covers `Chemical Engineer`, `Antenna Engineer (Starlink)`, `Avionics Test Engineer`, `Power Electronics Engineer`, `Commercial Sales Engineer` and `Customer Success Engineer`. So the check runs in a deliberate order, each step added because a real title broke the previous arrangement:

1. **Never-software roles out first** — recruiting, technicians, physical security. (`People Research Scientist, Recruiting` matched an explicit software word.)
2. **Go-to-market heads out** — the role noun itself is the giveaway. `Senior Customer Engineer — Cloudflare Developer Platform` is a customer engineer; the software words are the product being sold.
3. **Explicit software titles in**, beating any domain in the rest of the title. `Lead Software Engineer, Starship Manufacturing` and `Senior Analytics Engineer (Finance)` are software jobs.
4. **Other disciplines and functions out** — mechanical, chemical, avionics, propulsion, RF/ASIC, finance, legal, marketing, PM, design.
5. **Weak signal**: a software domain sitting near a role noun (`Engineering Lead, Web Platform`).
6. **Fallback**: a generic title like `Staff Engineer II` needs its team to vouch for it.

Steps 2 and 3 are the subtle pair. A GTM *head* beats a software word, but a software role *serving* a GTM team is still software — `Software Engineer, GTM Platform` and `Senior Staff Software Engineer, Marketing Technology` are kept, because they build the tooling.

Internships state their field without an engineer noun, so `intern`/`internship`/`co-op` count as role nouns: `ML Research Intern` qualifies, while `Sales Intern`, `Brand Social Media Intern` and `Recruiting Coordinator, Intern Program` do not.

Excluded by design: product management, design/UX, data *analysts* (data engineers and scientists are kept), IT/ERP administration, and hardware of every kind. Widen the lists in `role.js` if you want any of those — the tests will tell you what else the change lets in.

## Location and recency

The feed only ever contains roles that are **in the US, in Canada, or remote**, and **posted within the last 30 days**. Both are enforced at collection time in [src/poll.js](src/poll.js), so nothing outside them reaches the site or your inbox. The list is ordered newest-posted first.

Region matching lives in [src/region.js](src/region.js), tuned against 1,981 distinct location strings from 100 live boards. It prefers structured data where it exists — Ashby publishes a postal address per location, Lever an ISO-3166 country — and falls back to parsing the string, which is all Greenhouse offers.

The string parsing order exists because of specific real failures:

1. **`CC-Region-City` prefixes first.** `US-CA-Menlo Park`, `CA-Ontario-Toronto`, `IN-Pune`, `GB-London`. The leading code is always an ISO country in this format, never a US state.
2. **Explicit country next.** `Remote - USA` is a US role; `Remote (Canada)` is Canadian.
3. **Foreign countries before state codes.** `DE-Germany-Remote` must not read DE as Delaware.
4. **Canada before the US.** In `Toronto, ON, CA`, that trailing CA is Canada — but in `Palo Alto, CA` it is California.
5. **Ambiguous foreign cities after US states.** `London` is the UK one; `London, KY` is not.

Two-letter codes only count when the source wrote them in caps, or `In-Office` reads as Indiana — which is exactly what happened before the guard existed.

`Remote` is qualified by whatever country it names: `Remote - UK`, `Remote - India` and `MX-Mexico-Remote` are all dropped, while a bare `Remote` or `Distributed` counts. Multi-location postings union their regions, so `London, UK; New York, NY` is kept — you can take the New York one.

Roughly 4,400 of 15,300 postings are dropped as non-US/Canada, and ~7,200 as older than 30 days.

### Reading the `most dropped by region` line

Each run prints the three companies losing the most postings to the region filter. It means one of two very different things, so check before acting:

- **Genuinely foreign.** Databricks (99 — Bengaluru, Amsterdam, London), Okta (80 — 72 in Bengaluru), ClickHouse (52 — `Netherlands (remote)`, `Germany (remote)`). Nothing to fix; those roles simply are not in scope.
- **A board with unusable location data.** Cloudflare published `In-Office` or `Hybrid` as the location on every posting, losing 53 of 63 software roles including two Fall 2026 internships.

For the second case, Greenhouse's `?content=true` also returns `offices` and `departments`. Set `"contentApi": true` on that company:

```json
{ "name": "Cloudflare", "ats": "greenhouse", "slug": "cloudflare", "contentApi": true }
```

Currently enabled for Cloudflare (10 → 53 placed), Stripe (59 → 73) and Epic Games (36 → 39). It is opt-in because it inlines every job description — 4.7 MB versus 258 KB for the same board, on a ten-minute schedule.

Offices are used as a **fallback**, never a replacement, and only when the location string is vague. Epic Games is the counter-example that forced this: it lists office `Cary` on postings whose location is `Porto Alegre, Rio Grande do Sul, Brazil`. Preferring offices outright moved Brazilian roles to North Carolina and cut Epic's placed count from 36 to 7.

Where the title carries the place (`Software Engineer Intern (Fall 2026) - Austin, TX`) it is also recovered automatically.

## Intake terms

Intern and new-grad postings also get a `term` — `Summer 2027`, `Fall 2026`, `Fall/Winter 2026`, or a bare `2027` — parsed from the title by [src/term.js](src/term.js). The site's term dropdown is built from whatever is actually in your data (intakes move every year), sorted soonest-first, with a **No term listed** option for postings that never state one. It hides itself when nothing parsed a term.

Finding years is easy; rejecting the ones that are not intakes is the work. These are all real titles whose year means something else:

| Title | What the year is |
|---|---|
| `Marketing Analyst - 11/2025` | posting date |
| `Data Analyst Nov 2020` | posting date |
| `Connect with us at ICLR 2026!` | conference |
| `Data Center Compute, OpenHouse Savannah 2026` | event |
| `LON - 2026 - Senior Manager Compensation` | internal code |
| `Point72 Academy 2026 … for Experienced Professionals` | program year, not an intake |

Every one is an `experienced` role, so **terms are only parsed for intern and new-grad postings** — that single gate removes the whole category without title heuristics. On top of it: `MM/YYYY` and month-name prefixes are rejected, and years outside `[this year − 1, this year + 3]` are dropped, which catches stale reposts and typos.

Handled formats, all from live boards: `(Fall 2026)`, `(Fall, 2026)`, `- Summer 2027`, `Summer 2027 Quantitative Research Internship`, `2027 - Software Engineering Intern - BITS Pilani`, `(2027 Start)`, `Graduate Software Engineer (2026)`, `2026-2027` (takes the first year), and `Autumn` folded into `Fall`.

A posting spanning two seasons — `Software Engineer Intern (Fall / Winter 2026)` — is reachable from *either* filter option, while its label keeps the posting's own wording.

Over 6,935 live titles this finds 30 terms with zero false positives.

## Testing

```bash
npm test
```

Node's built-in runner, 51 tests, still zero dependencies. The suite asserts against the real titles quoted above — including every false positive — so changing a pattern tells you immediately what it broke.

The browser imports `src/classify.js` and `src/term.js` directly (both are dependency-free ESM), so the site filters with the exact code the poller classified with. There is no second copy of the key format to drift.

## Deploying

1. Create a **public** repo and push.
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Settings → Actions → General → Workflow permissions: **Read and write**.
4. The workflow runs on the `*/10` cron and commits `data/` back. Trigger the first run by hand from the Actions tab (`poll` → *Run workflow*).

Site lands at `https://<user>.github.io/<repo>/`.

Two Actions caveats: scheduled runs drift 5–20 minutes under load, and GitHub disables cron workflows after 60 days of repo inactivity — the bot's own commits count as activity, so this only matters if nothing ever changes.

## Email alerts (optional)

Everything works without this. To enable, add repo secrets under Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) (free tier: 100/day) |
| `ALERT_EMAIL_TO` | Your address. Comma-separate for several. |
| `ALERT_EMAIL_FROM` | Optional. Defaults to `onboarding@resend.dev`, which works before you verify a domain. |

One email per poll containing all new roles grouped by company — never one per job. Send failures are logged, never fatal: a mail outage must not block the data commit, or the next run would re-report the same jobs as new.

## Data files

- `data/jobs.json` — what the site reads: all currently open roles, plus per-company health.
- `data/state.json` — bookkeeping: full snapshot, `firstSeen` timestamps, empty-response streaks, recently removed roles.

Both are committed. The repo is the database.

Delete `data/` to start over — the next run re-seeds and sends no email.

## Failure behaviour

The rules that keep it from becoming a spam machine:

- **Fetch fails** (timeout, 404, 500) — that company's previous jobs are carried forward untouched and the site shows a red banner. No delete-then-rediscover storm.
- **Board returns `[]`** — treated as a soft failure for 3 consecutive polls before it is believed, since ATS maintenance and dead Lever slugs both look like an empty board.
- **First run** — every job is marked `seeded`: listed and searchable, but never highlighted as new and never emailed.
- **Job disappears** — dropped from the site, logged in `state.recentlyRemoved` (last 100). No email.
