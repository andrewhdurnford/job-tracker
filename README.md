# Job Tracker

Polls company ATS boards (Ashby, Greenhouse, Lever, Workday, iCIMS) every ~10 minutes, diffs against the last snapshot, publishes a static site, and emails when new roles appear.

Zero dependencies: Node 20+ and nothing else.

## Run it locally

```bash
node src/poll.js
```

First run seeds `data/state.json` and sends no email. Every run after that reports only genuine additions.

View the site:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Adding companies

Edit `companies.json`. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for config fields, ATS slug lookup, deploying, and testing.
