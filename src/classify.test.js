import test from "node:test";
import assert from "node:assert/strict";

import { classifyLevel } from "./classify.js";

// Every title below is a real posting pulled from live Ashby, Greenhouse and
// Lever boards while building the classifier.

test("intern titles", () => {
  const titles = [
    "Software Engineer, Internship",
    "Software Engineer Intern (Fall 2026)",
    "Software Engineer Internship, Android",
    "Software Engineer, Intern",
    "Engineering Intern",
    "Deployment Strategist, Internship - US Government",
    "Forward Deployed Software Engineer, Internship - Defense Tech",
    "Governance, Risk, and Compliance Intern (Fall 2026)",
    "Machine Learning Intern/Co-op  (Fall, 2026)",
    "PhD GenAI Research Scientist Intern",
    "Research Internship (Fall, 2026)",
    "Professional Services Intern",
    "Product Management Intern (Summer 2027)",
    "Sales Intern",
    "Intern III",
    "Interns",
    "Internship",
    "Auror Internship",
  ];
  for (const title of titles) {
    assert.equal(classifyLevel({ title }), "intern", title);
  }
});

test("internal / international / internals are not internships", () => {
  const titles = [
    "Internal Audit Analyst",
    "Internal Audit Lead, Stablecoins & Digital Assets",
    "Senior Manager, Internal Audit IT",
    "Internal Communications, Enterprise & Growth",
    "Internal Consultant, Engineering",
    "Product Designer, Internal Tools",
    "Software Engineer, Internal Systems",
    "Software Engineer, Internal Applications - Enterprise",
    "Director, International Operations",
    "International Tax Manager",
    "Software Engineer, International",
    "Senior PM, International Trading",
    "Software Engineer - Database Engine Internals",
    "Staff Software Engineer - Database Engine Internals",
  ];
  for (const title of titles) {
    assert.equal(classifyLevel({ title }), "experienced", title);
  }
});

test("cooperative and stage lookalikes are not internships", () => {
  const titles = [
    "Software Engineer, Cooperative AI",
    "Software Engineer, Backend (Cooperative AI)",
    "Engineering Manager, Cooperative Systems",
    "Account Executive, Early Stage",
    "Senior Account Executive, Growth Stage",
    "Head of Backstage Marketing",
  ];
  for (const title of titles) {
    assert.equal(classifyLevel({ title }), "experienced", title);
  }
});

test("new grad titles", () => {
  const titles = [
    "Forward Deployed Software Engineer, New Grad - US Government",
    "Privacy & Civil Liberties Engineer - New Grad",
    "Risk Analyst - New Grad",
    "Customer Experience Associate (New Grad)",
    "Associate Product Manager, New Grad (2027 Start)",
    "Account Executive, Corporate - University Hire",
    "Software Engineer, Early Career",
    "Software Engineer, Early Career (AI)",
    "Apprentice Electrician",
  ];
  for (const title of titles) {
    assert.equal(classifyLevel({ title }), "new-grad", title);
  }
});

test("recruiting roles for early-career talent are not early-career roles", () => {
  assert.equal(
    classifyLevel({ title: "Head of Early Career Recruiting" }),
    "experienced",
  );
  assert.equal(
    classifyLevel({ title: "University Recruiter, Campus Hires" }),
    "experienced",
  );
  // ...but an internship in the recruiting team still is one.
  assert.equal(classifyLevel({ title: "Recruiting Intern" }), "intern");
});

test("structured employment type wins when the title is silent", () => {
  // Ashby's enum
  assert.equal(
    classifyLevel({ title: "Software Engineer", employmentType: "Intern" }),
    "intern",
  );
  // Lever's free-text commitment
  assert.equal(
    classifyLevel({ title: "Data Analyst", employmentType: "Internship" }),
    "intern",
  );
  // Lever's commitment field is company-authored junk more often than not;
  // none of these may promote a role out of "experienced".
  for (const employmentType of [
    "Full-time",
    "Permanent",
    "Regular Full Time (Salary)",
    "Hybrid Remote",
    "Contract",
    "Fixed-Term",
    undefined,
    null,
  ]) {
    assert.equal(
      classifyLevel({ title: "Software Engineer", employmentType }),
      "experienced",
      String(employmentType),
    );
  }
});

test("the title beats the employment type when they disagree", () => {
  assert.equal(
    classifyLevel({
      title: "Software Engineer, Internship",
      employmentType: "FullTime",
    }),
    "intern",
  );
  // Real posting: Lever commitment said "Internship", the title said New Grad.
  assert.equal(
    classifyLevel({
      title: "Risk Analyst - New Grad",
      employmentType: "Internship",
    }),
    "new-grad",
  );
});

test("plain senior roles stay experienced", () => {
  for (const title of [
    "Senior Software Engineer, Backend",
    "Staff Software Engineer",
    "Software Engineer",
    "Product Manager",
    "Forward Deployed Engineer",
  ]) {
    assert.equal(classifyLevel({ title }), "experienced", title);
  }
});

test("missing or malformed input does not throw", () => {
  assert.equal(classifyLevel(), "experienced");
  assert.equal(classifyLevel({}), "experienced");
  assert.equal(classifyLevel({ title: null }), "experienced");
});
