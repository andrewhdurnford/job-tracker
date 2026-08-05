import test from "node:test";
import assert from "node:assert/strict";

import { parseTerm, termKeys, termKeyLabel, compareTermKeys } from "./term.js";

// Titles below are real postings pulled from live boards. The corpus was
// collected in 2026, so tests pin `now` rather than depending on the wall clock.
const NOW = new Date("2026-07-28T00:00:00Z");

const term = (title, level = "intern") => parseTerm(title, level, { now: NOW });

test("season + year in parentheses", () => {
  assert.deepEqual(term("Software Engineer Intern (Fall 2026)"), {
    label: "Fall 2026",
    seasons: ["fall"],
    year: 2026,
  });
  assert.deepEqual(term("Research Internship (Fall, 2026)"), {
    label: "Fall 2026",
    seasons: ["fall"],
    year: 2026,
  });
  assert.deepEqual(term("Product Management Intern (Summer 2027)"), {
    label: "Summer 2027",
    seasons: ["summer"],
    year: 2027,
  });
});

test("season + year after a dash, and leading the title", () => {
  assert.equal(term("Software Engineer Intern - Summer 2027").label, "Summer 2027");
  assert.equal(term("Hardware Engineer Intern - Summer 2027").label, "Summer 2027");
  assert.equal(
    term("Summer 2027 Quantitative Research Internship").label,
    "Summer 2027",
  );
  assert.equal(
    term("Quantitative Research Intern (BS/MS) - Summer 2027").label,
    "Summer 2027",
  );
});

test("multi-season intakes keep both seasons", () => {
  const parsed = term("Software Engineer Intern (Fall / Winter 2026)");
  // Label follows the posting's own wording...
  assert.deepEqual(parsed.seasons, ["fall", "winter"]);
  assert.equal(parsed.label, "Fall/Winter 2026");
  assert.equal(parsed.year, 2026);
  // ...while keys are canonically ordered, and reachable from either option.
  assert.deepEqual(termKeys(parsed), ["winter-2026", "fall-2026"]);
});

test("year with no season", () => {
  assert.deepEqual(term("2027 - Software Engineering Intern - BITS Pilani"), {
    label: "2027",
    seasons: [],
    year: 2027,
  });
  assert.equal(term("2026 Warsaw MI Data – Web Scraping Internship").label, "2026");
  assert.equal(
    term("Associate Product Manager, New Grad (2027 Start)", "new-grad").label,
    "2027",
  );
  assert.equal(term("Graduate Software Engineer (2026)", "new-grad").label, "2026");
});

test("year leading with the season later in the title", () => {
  assert.equal(
    term("2027 Point72 Academy Investment Analyst Summer Internship Program - Hong Kong")
      .label,
    "Summer 2027",
  );
});

test("autumn is folded into fall", () => {
  assert.deepEqual(term("Software Engineer Intern (Autumn 2026)").seasons, ["fall"]);
});

test("a year range takes the intake year", () => {
  assert.equal(term("Analyst Program 2026-2027 Internship").year, 2026);
});

test("experienced roles never get a term", () => {
  // Every one of these is a real title whose year is a conference, an event,
  // an internal code or a posting date — not an intake.
  const titles = [
    "Connect with us at ICLR 2026!",
    "ISCA 2026",
    "Data Center Compute, OpenHouse Savannah 2026",
    "Prosperity 2026 - Role Interest Form",
    "LON - 2026 - Senior Manager Compensation",
    "Marketing Analyst - 11/2025",
    "Senior Magento Developer -11/2025",
    "Data Analyst Nov 2020",
    "Point72 Academy 2026 Investment Analyst Program for Experienced Professionals - UK",
  ];
  for (const title of titles) {
    assert.equal(parseTerm(title, "experienced", { now: NOW }), null, title);
  }
});

test("posting dates inside an intern title are still rejected", () => {
  assert.equal(term("Software Engineering Intern - 11/2025"), null);
  assert.equal(term("Software Engineering Intern (Nov 2026)"), null);
  assert.equal(term("Software Engineering Intern - Sept 2026"), null);
});

test("years far outside the hiring window are rejected", () => {
  assert.equal(term("Software Engineering Intern 2019"), null); // stale repost
  assert.equal(term("Software Engineering Intern 2031"), null); // typo/garbage
  assert.equal(term("Software Engineering Intern 2025").label, "2025"); // last year, still plausible
  assert.equal(term("Software Engineering Intern 2029").label, "2029"); // three years out
});

test("titles with no term at all", () => {
  assert.equal(term("Software Engineer, Internship"), null);
  assert.equal(term("Engineering Intern"), null);
  assert.equal(term(""), null);
  assert.equal(term(null), null);
});

test("season with no year", () => {
  const parsed = term("Summer Analyst, Investment Banking");
  assert.deepEqual(parsed, { label: "Summer", seasons: ["summer"], year: null });
  assert.deepEqual(termKeys(parsed), ["summer"]);
});

test("keys and labels round-trip", () => {
  assert.deepEqual(termKeys(term("Software Engineer Intern (Fall 2026)")), [
    "fall-2026",
  ]);
  assert.deepEqual(termKeys(null), []);
  assert.equal(termKeyLabel("fall-2026"), "Fall 2026");
  assert.equal(termKeyLabel("summer-2027"), "Summer 2027");
  assert.equal(termKeyLabel("summer"), "Summer");
  assert.equal(termKeyLabel("2027"), "2027");
});

test("filter options sort chronologically", () => {
  const keys = ["fall-2026", "summer-2027", "winter-2026", "2027", "spring-2027"];
  assert.deepEqual(keys.sort(compareTermKeys), [
    "winter-2026",
    "fall-2026",
    "spring-2027",
    "summer-2027",
    "2027",
  ]);
});
