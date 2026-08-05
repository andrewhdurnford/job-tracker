import test from "node:test";
import assert from "node:assert/strict";

import { regionsFor, countryRegion, isVagueLocation } from "./region.js";

// Every location string below is real, taken from the 1,981 distinct values
// across 100 live boards.
const at = (...locations) => regionsFor({ locations });

test("US states, abbreviated and spelled out", () => {
  assert.deepEqual(at("Hawthorne, CA"), ["us"]);
  assert.deepEqual(at("New York, NY"), ["us"]);
  assert.deepEqual(at("San Francisco, California"), ["us"]);
  assert.deepEqual(at("San Mateo, CA, United States"), ["us"]);
  assert.deepEqual(at("US-CA-Menlo Park"), ["us"]);
  assert.deepEqual(at("New York, New York, USA"), ["us"]);
  assert.deepEqual(at("Washington, D.C."), ["us"]);
  assert.deepEqual(at("United States"), ["us"]);
});

test("bare US city names", () => {
  assert.deepEqual(at("San Francisco"), ["us"]);
  assert.deepEqual(at("Chicago"), ["us"]);
  assert.deepEqual(at("New York City"), ["us"]);
  assert.deepEqual(at("San Francisco Bay Area"), ["us"]);
  assert.deepEqual(at("Starbase"), ["us"]);
});

test("Canada", () => {
  assert.deepEqual(at("Toronto, Canada"), ["canada"]);
  assert.deepEqual(at("Vancouver, BC"), ["canada"]);
  assert.deepEqual(at("Montreal,Quebec,Canada"), ["canada"]);
  assert.deepEqual(at("Toronto"), ["canada"]);
  assert.deepEqual(at("Canada - Remote (ON, AB, BC, or NS Only)"), ["canada"]);
  assert.deepEqual(at("Remote - Ontario, Canada"), ["canada"]);
});

test("'CA' is California in a location string but Canada as an ISO code", () => {
  assert.deepEqual(at("Palo Alto, CA"), ["us"]);
  // ...unless a province already claimed it: "Toronto, ON, CA".
  assert.deepEqual(at("Toronto, ON, CA"), ["canada"]);
  // Lever's structured country field is ISO-3166, where CA is Canada.
  assert.equal(countryRegion("CA"), "canada");
  assert.equal(countryRegion("US"), "us");
  assert.equal(countryRegion("GB"), null);
  // Ashby's is a country name.
  assert.equal(countryRegion("United States"), "us");
  assert.equal(countryRegion("USA"), "us");
  assert.equal(countryRegion("Canada"), "canada");
  assert.equal(countryRegion("Germany"), null);
});

test("remote is qualified by whatever country it names", () => {
  assert.deepEqual(at("Remote - US"), ["us"]);
  assert.deepEqual(at("Remote - USA"), ["us"]);
  assert.deepEqual(at("Remote - United States"), ["us"]);
  assert.deepEqual(at("Remote US"), ["us"]);
  assert.deepEqual(at("Remote Canada"), ["canada"]);
  assert.deepEqual(at("Remote (Canada)"), ["canada"]);
  assert.deepEqual(at("Remote - SF Bay Area"), ["us"]);
  // Unqualified: no country to contradict it.
  assert.deepEqual(at("Remote"), ["remote"]);
  assert.deepEqual(at("Distributed"), ["remote"]);
});

test("remote somewhere else is not remote here", () => {
  for (const location of [
    "Remote - UK",
    "Remote UK",
    "UK (remote)",
    "Remote - India",
    "Remote - Ireland",
    "Remote (Germany)",
    "Remote (Portugal)",
    "Remote - Cyprus",
    "MX-Mexico-Remote",
    "JP-Japan-Remote",
    "GB-United Kingdom-Remote",
    " -REMOTE, BULGARIA-",
    "EMEA(Remote)",
    "Singapore(Remote)",
    "Australia(Remote)",
    "Remote, KSA; Remote, UAE",
    "Netherlands (remote)",
    "Remote Poland",
  ]) {
    assert.deepEqual(at(location), [], location);
  }
});

test("a country prefix is not a state abbreviation", () => {
  // DE = Delaware and IN = Indiana, but these are Germany and India.
  assert.deepEqual(at("DE-Germany-Remote"), []);
  assert.deepEqual(at("IN-India-Remote"), []);
  assert.deepEqual(at("IN-Pune"), []);
  assert.deepEqual(at("GB-London"), []);
  assert.deepEqual(at("JP-Tokyo"), []);
  assert.deepEqual(at("PL-Warsaw-Lixa C"), []);
});

test("the Workday-style country prefix settles US and Canada too", () => {
  assert.deepEqual(at("US-CA-Menlo Park"), ["us"]);
  assert.deepEqual(at("US-WA-Bellevue"), ["us"]);
  assert.deepEqual(at("US-Remote"), ["us"]);
  // Here the leading CA really is Canada, and the second token is the province.
  assert.deepEqual(at("CA-Ontario-Toronto"), ["canada"]);
});

test("plain foreign locations are dropped", () => {
  for (const location of [
    "London",
    "London, UK",
    "London, United Kingdom",
    "London, England",
    "Bengaluru, India",
    "Bangalore, IND",
    "Singapore",
    "Tokyo, Japan",
    "Dublin, Ireland",
    "Sydney, Australia",
    "Amsterdam",
    "Paris, France",
    "Mexico City",
    "São Paulo",
    "Seoul, South Korea",
    "Berlin, Germany",
    "Warsaw",
    "Munich",
  ]) {
    assert.deepEqual(at(location), [], location);
  }
});

test("an explicit US state beats an ambiguous city name", () => {
  assert.deepEqual(at("London, KY"), ["us"]);
  assert.deepEqual(at("Cambridge, MA"), ["us"]);
  assert.deepEqual(at("Birmingham, AL"), ["us"]);
});

test("'Portland, OR' keeps Oregon — OR is not a separator", () => {
  assert.deepEqual(at("Bend, OR"), ["us"]);
  assert.deepEqual(at("Portland, OR"), ["us"]);
  // Lower-case "or" still splits alternatives.
  assert.deepEqual(at("San Francisco Bay Area or Remote"), ["us", "remote"]);
});

test("multi-location strings union their regions", () => {
  assert.deepEqual(at("San Francisco, CA • New York, NY • United States"), ["us"]);
  assert.deepEqual(at("San Francisco, CA | New York City, NY"), ["us"]);
  assert.deepEqual(at("San Francisco, CA, US; Remote, US"), ["us"]);
  assert.deepEqual(at("Toronto, Canada; Vancouver, Canada"), ["canada"]);
  // A posting open in London *and* New York still counts — you can take the NY one.
  assert.deepEqual(at("London, UK; New York, NY"), ["us"]);
  assert.deepEqual(at("Remote, Canada; Remote, US"), ["us", "canada"]);
  assert.deepEqual(at("Remote, Brazil; Remote, Mexico; Remote, United States"), ["us"]);
});

test("North America covers both tracked countries", () => {
  assert.deepEqual(at("North America"), ["us", "canada"]);
});

test("structured country data is merged with the strings", () => {
  // Ashby: a US-listed role with a Canadian secondary location.
  assert.deepEqual(
    regionsFor({
      locations: ["New York, NY (HQ)", "Remote (Canada)", "Miami, FL"],
      countries: ["United States", "Canada", "USA"],
    }),
    ["us", "canada"],
  );
  // Lever: ISO country rescues an unparseable string.
  assert.deepEqual(regionsFor({ locations: ["Hybrid"], countries: ["US"] }), ["us"]);
});

test("a lower-case two-letter word is not a state code", () => {
  // "In-Office" must not read as Indiana, "Hybrid or Remote" not as anything.
  assert.deepEqual(at("In-Office"), []);
  assert.deepEqual(at("Hybrid; In-Office"), []);
  assert.deepEqual(at("Hybrid or Remote"), ["remote"]);
  // Caps still work, which is how every real board writes them.
  assert.deepEqual(at("Indianapolis, IN"), ["us"]);
});

test("a vague location is distinguishable from an unresolved real place", () => {
  // Vague: a work arrangement or placeholder. Justifies using another field.
  for (const value of ["In-Office", "Hybrid", "N/A", "BLANK,BLANK,Multiple Locations", "", "  "]) {
    assert.equal(isVagueLocation(value), true, JSON.stringify(value));
  }
  // Real places, even ones we deliberately drop. Must NOT trigger a fallback,
  // or Epic Games' office "Cary" would relocate a Brazil posting to the US.
  for (const value of ["Porto Alegre,Rio Grande do Sul,Brazil", "London", "Bengaluru, India"]) {
    assert.equal(isVagueLocation(value), false, value);
  }
});

test("vague or junk locations resolve to nothing", () => {
  for (const location of [
    "Hybrid",
    "In-Office",
    "N/A",
    "BLANK,BLANK,Multiple Locations",
    "Multiple Locations",
    "",
  ]) {
    assert.deepEqual(at(location), [], location);
  }
  assert.deepEqual(regionsFor(), []);
  assert.deepEqual(regionsFor({}), []);
});
