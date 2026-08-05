import test from "node:test";
import assert from "node:assert/strict";

import { toIso } from "./workday.js";

// Every string below is the literal `postedOn` value seen on live Adobe,
// Capital One and Nvidia Workday boards.

test("Posted Today resolves to now", () => {
  const iso = toIso("Posted Today");
  assert.ok(iso);
  assert.ok(Date.now() - Date.parse(iso) < 5000);
});

test("Posted Yesterday resolves to ~1 day ago", () => {
  const iso = toIso("Posted Yesterday");
  const ageMs = Date.now() - Date.parse(iso);
  assert.ok(Math.abs(ageMs - 86_400_000) < 5000);
});

test("Posted N Days Ago resolves to N days ago", () => {
  for (const n of [2, 6, 11, 16, 29]) {
    const ageMs = Date.now() - Date.parse(toIso(`Posted ${n} Days Ago`));
    assert.ok(Math.abs(ageMs - n * 86_400_000) < 5000, `n=${n}`);
  }
});

test("Posted 30+ Days Ago lands past the default 30-day cutoff", () => {
  const iso = toIso("Posted 30+ Days Ago");
  const ageDays = (Date.now() - Date.parse(iso)) / 86_400_000;
  assert.ok(ageDays > 30);
});

test("unrecognized or missing text yields null, not a guess", () => {
  assert.equal(toIso(undefined), null);
  assert.equal(toIso(""), null);
  assert.equal(toIso("Reposted"), null);
});
