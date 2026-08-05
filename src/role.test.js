import test from "node:test";
import assert from "node:assert/strict";

import { isSoftwareRole } from "./role.js";

// Every title below is a real posting from the tracked boards.
const soft = (title, team = null) => isSoftwareRole({ title, team });

test("plain software titles", () => {
  for (const title of [
    "Software Engineer",
    "Senior Software Engineer, Backend (Consumer - Growth Foundations)",
    "Staff Backend Engineer, Host Pricing & Availability",
    "Full Stack Engineer, Link",
    "Sr. Full Stack Engineer, Employee Experience",
    "Android Engineer II (Hardware Accelerate)",
    "AI Programmer",
    "Build Programmer",
    "Principal Software Developer - Security - Elasticsearch",
    "Cloud Infrastructure Engineer",
    "Release Engineer",
    "Senior Platform Engineer",
  ]) {
    assert.equal(soft(title), true, title);
  }
});

test("'Full Stack' with a space, not just a hyphen", () => {
  // A `full-?stack` pattern silently missed every one of these.
  assert.equal(soft("Full Stack Engineer, Support Experience"), true);
  assert.equal(soft("Sr. Full Stack Engineer, Manufacturing Systems"), true);
  assert.equal(soft("Full Stack Software Engineer, Observability (Starlink)"), true);
});

test("ML, data and security engineering count", () => {
  for (const title of [
    "Senior Machine Learning Engineer, Core Algorithms",
    "Principal Security ML Research Engineer",
    "Senior AI Research Engineer",
    "Product Security Engineer II",
    "Senior Data Platform Engineer",
    "Staff Analytics Engineer - Accounting",
    "Senior Analytics Engineer (Finance)",
    "Data Scientist, Core Infrastructure",
    "Software Engineer II, ML Ops",
  ]) {
    assert.equal(soft(title), true, title);
  }
});

test("engineering leadership over software", () => {
  assert.equal(soft("Engineering Manager, Platform Infrastructure (Foundations)"), true);
  assert.equal(soft("Engineering Lead, Web Platform"), true);
  assert.equal(soft("Tech Lead, ARC Team"), true);
  assert.equal(soft("Engineering Leader, Infrastructure"), true);
});

test("other engineering disciplines are not software", () => {
  for (const title of [
    "Chemical Engineer",
    "Civil Engineer",
    "Mechanical Engineer I",
    "Sr. Electrical Engineer",
    "Power Electronics Engineer - High Voltage (Starlink)",
    "Antenna Engineer (Starlink)",
    "Avionics Test Engineer (Starfall)",
    "Propulsion Engineer (Raptor Combustion Devices)",
    "Battery Systems Engineer II",
    "Sr. Materials Engineer, AI Satellites (Starmind)",
    "Sr. ASIC Design Verification Engineer (Silicon Engineering)",
    "Sr. RF/Microwave Engineer (RFIC Engineering)",
    "Environmental Engineer",
    "Facilities Operations Engineer (Starlink)",
    "Automation & Controls Engineer (Raptor Manufacturing Systems)",
  ]) {
    assert.equal(soft(title), false, title);
  }
});

test("'Engineer' on a go-to-market role is not software", () => {
  for (const title of [
    "Commercial Sales Engineer - NY/NJ",
    "Senior Sales Engineer, Majors - PacNW",
    "Solution Engineer",
    "Senior Solution Engineer - Defense Industrial Base (DIB)",
    "Enterprise Technical Solutions Engineer",
    "Customer Engineer, Agent Builder - Spanish Speaking",
    "Senior Customer Engineer, Digital Native Enterprise - New York",
    "Customer Solutions Architect",
    "Account Engineer - Public Sector/SLED",
    "Field Engineer, Public Sector",
    "Commercial Solutions Architect - Texas",
    "Director, Customer Engineering",
  ]) {
    assert.equal(soft(title), false, title);
  }
});

test("a go-to-market head beats an explicit software word", () => {
  // The role noun is "Customer Engineer"; the software words are the product.
  assert.equal(
    soft("Senior Customer Engineer- Cloudflare Developer Platform (Start-Ups) Washington DC"),
    false,
  );
  assert.equal(soft("Lead Product Marketing Manager, Developer Experience"), false);
  assert.equal(soft("Product Manager II - Developer Engagement"), false);
});

test("...but a software role serving a GTM team still counts", () => {
  // These build the internal tooling; they are engineering jobs.
  assert.equal(soft("Software Engineer, GTM Platform"), true);
  assert.equal(soft("Staff Software Engineer, GTM Systems"), true);
  assert.equal(soft("Senior Staff Software Engineer, Marketing Technology"), true);
  assert.equal(soft("Senior Staff Software Engineer, Legal Automation"), true);
  assert.equal(soft("Staff Software Engineer, HR Experiences"), true);
});

test("non-technical functions are out", () => {
  for (const title of [
    "Senior Account Executive, Federal Defense and Intelligence",
    "Vice President, Investor Relations",
    "Wholesale Operations Analyst",
    "Business Analyst I (Growth Marketing)",
    "Sr. Director, Consumer Communications",
    "Product Designer, CMS",
    "Staff Industrial Designer",
    "Senior Product Manager, Crypto Wallet",
    "Security Technical Program Manager",
    "AI Risk & Compliance Analyst",
    "Staff Regulatory Affairs Associate (Digital Health & AI Technologies)",
    "People Research Scientist, Recruiting",
    "Cook - Temporary",
  ]) {
    assert.equal(soft(title), false, title);
  }
});

test("internships state their field without an engineer noun", () => {
  assert.equal(soft("ML Research Intern"), true);
  assert.equal(soft("Machine Learning Intern/Co-op  (Fall, 2026)"), true);
  assert.equal(soft("Research Internship (Fall, Winter 2026)"), true);
  assert.equal(soft("Software Engineer Intern (Fall 2026) - Austin, TX"), true);
  // ...and the non-software ones still do not qualify.
  assert.equal(soft("Brand Social Media Intern (Fall 2026)"), false);
  assert.equal(soft("Sales Intern"), false);
  assert.equal(soft("AI Innovation Intern – Service Sales (Fall 2026)"), false);
  assert.equal(soft("Governance, Risk, and Compliance Intern (Fall 2026)"), false);
  assert.equal(soft("Recruiting Coordinator, Intern Program- Temporary"), false);
});

test("a generic engineering title leans on its team", () => {
  assert.equal(soft("Staff Engineer II"), false);
  assert.equal(soft("Staff Engineer II", "Engineering"), true);
  assert.equal(soft("Staff Engineer II", "Software"), true);
  assert.equal(soft("Staff Engineer II", "Hardware"), false);
  assert.equal(soft("Staff Engineer II", "Sales"), false);
});

test("malformed input does not throw", () => {
  assert.equal(isSoftwareRole(), false);
  assert.equal(isSoftwareRole({}), false);
  assert.equal(soft(""), false);
  assert.equal(soft(null), false);
});
