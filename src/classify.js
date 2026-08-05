/**
 * Classify a posting as intern / new-grad / experienced.
 *
 * Patterns here were built against ~3,600 live titles from Ashby, Greenhouse
 * and Lever boards. The comments name the real titles each rule exists for —
 * do not "simplify" a boundary away without re-running classify.test.js.
 */

// \b does the heavy lifting: "Internal Audit", "International Tax" and
// "Database Engine Internals" all fail \bintern\b because the next character
// is a word character. "Cooperative AI" fails \bco-?op\b for the same reason.
const INTERN = new RegExp(
  [
    "\\bintern(?:s|ship|ships)?\\b", // Intern, Interns, Internship, "Intern III"
    "\\bco-?op\\b", // "Machine Learning Intern/Co-op"
    "\\bintern/co-?op\\b",
    "\\bsummer\\s+analyst\\b", // finance's word for intern
    "\\bpraktik\\w*\\b", // Praktikum / Praktikant (DE)
    "\\bwerkstudent\\w*\\b", // working student (DE)
    // "placement" alone hits ad-industry roles like "Media Placement Lead",
    // so it only counts with a qualifier.
    "\\b(?:industrial|summer|student|sandwich|year)\\s+placement\\b",
    "\\bplacement\\s+(?:year|student|programme|program)\\b",
  ].join("|"),
  "i",
);

const NEW_GRAD = new RegExp(
  [
    "\\bnew\\s?grads?\\b", // "Risk Analyst - New Grad"
    "\\bnew\\s?graduates?\\b",
    "\\buniversity\\s+(?:hire|grad|grads|graduate|graduates)\\b", // "Corporate - University Hire"
    "\\bcampus\\s+(?:hire|hires)\\b",
    "\\bgraduate\\s+(?:program|programme|scheme|analyst|engineer|developer|role|rotation)\\b",
    "\\bearly\\s+career\\b", // "Software Engineer, Early Career"
    "\\bearly[\\s-]talent\\b",
    "\\bentry[\\s-]level\\b",
    "\\bapprentice(?:ship)?s?\\b", // "Apprentice Electrician"
    "\\brotational\\s+program(?:me)?\\b",
  ].join("|"),
  "i",
);

// A role that *recruits* early-career people is not an early-career role.
// Catches "Head of Early Career Recruiting" and "University Recruiter".
// Deliberately not applied to interns — "Recruiting Intern" is a real intern.
const RECRUITING = /\b(?:recruit\w*|talent\s+acquisition|sourcer)\b/i;

/**
 * @param {{title?: string, employmentType?: string|null}} job
 * @returns {"intern"|"new-grad"|"experienced"}
 */
export function classifyLevel({ title = "", employmentType = null } = {}) {
  const text = String(title ?? "");

  // Title first. Lever's commitment field is company-authored and does get set
  // wrong — a real posting titled "Risk Analyst - New Grad" carried
  // commitment "Internship". An explicit title beats a loose metadata field.
  if (INTERN.test(text)) return "intern";
  if (NEW_GRAD.test(text) && !RECRUITING.test(text)) return "new-grad";

  // Title said nothing about level: fall back to the structured field. Ashby's
  // employmentType is a clean enum ("Intern"); Lever's "Internship" is worth
  // trusting when there is nothing else to go on.
  if (/^intern/i.test(String(employmentType ?? "").trim())) return "intern";

  return "experienced";
}

export const LEVELS = ["intern", "new-grad", "experienced"];

export const LEVEL_LABELS = {
  intern: "Internship",
  "new-grad": "New grad",
  experienced: "Experienced",
};
