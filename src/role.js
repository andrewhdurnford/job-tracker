/**
 * Decide whether a posting is a software role.
 *
 * "Engineer" in a title means almost nothing on its own. Across the tracked
 * boards it also covers Chemical Engineer, Antenna Engineer (Starlink),
 * Avionics Test Engineer, Power Electronics Engineer, Commercial Sales
 * Engineer and Customer Success Engineer.
 *
 * Evaluation order, each step justified by a real title that broke the
 * previous arrangement:
 *
 *   1. Go-to-market roles are out, whatever technical words they carry.
 *      "Enterprise Technical Solutions Engineer" is a quota job.
 *   2. A strong software signal wins next, even against a non-software
 *      domain: "Sr. Full Stack Engineer, Manufacturing Systems" is software
 *      work at a manufacturing org, and "Senior Analytics Engineer (Finance)"
 *      is data engineering for the finance team.
 *   3. Other engineering disciplines and non-technical functions are out.
 *   4. Anything left needs a software team to vouch for it.
 */

// "intern" is a role noun too, or "ML Research Intern" and "Machine Learning
// Intern/Co-op" fall through with no engineer/scientist word to match.
const ROLE_NOUN =
  "(?:engineer|engineering|developer|programmer|scientist|architect|intern(?:ship)?|co-?op)";

// Domains that make a role noun software. Paired with ROLE_NOUN below so
// "AI Risk & Compliance Analyst" and "Senior Product Manager – Observability
// Data Platform" do not qualify on the domain word alone.
const SOFTWARE_DOMAIN = [
  "software","back[- ]?end","front[- ]?end","full[- ]?stack","web","mobile","ios",
  "android","platform","infrastructure","cloud","distributed systems",
  "systems","compiler","kernel","embedded","firmware","database","data",
  "analytics","machine learning","ml","ai","artificial intelligence",
  "deep learning","nlp","computer vision","perception","research","applied",
  "security","identity","cryptograph","blockchain","api","forward deployed",
  "site reliability","reliability","observability","developer",
];

// Unambiguous: these outrank a non-software domain in the same title, because
// "Lead Software Engineer, Starship Manufacturing" really is a software job.
const EXPLICIT = new RegExp(
  [
    "software","\\bswe\\b","back[- ]?end","front[- ]?end","full[- ]?stack",
    "\\bprogrammer\\b","developer","\\bsre\\b","site reliability","devops",
    "\\bsdet\\b","platform engineer","infrastructure engineer",
    "cloud engineer","data engineer","analytics engineer",
    "machine learning engineer","\\bml engineer","\\bai engineer",
    "research engineer","applied scientist","research scientist",
    "security engineer","mobile engineer","\\bios engineer","android engineer",
    "web engineer","compiler","kernel engineer","embedded engineer",
    "firmware engineer","test automation","qa engineer","quality engineer",
    "technical lead","tech lead","release engineer","build engineer",
  ].join("|"),
  "i",
);

// Weaker: a software domain sitting near a role noun. Only consulted after the
// discipline and function exclusions, or "Sr. Materials Engineer, AI
// Satellites" and "Risk & Compliance Engineer - Data" sneak through.
const DOMAIN_PROXIMITY = new RegExp(
  [
    `(?:${SOFTWARE_DOMAIN.join("|")})[\\w\\s,&/'-]{0,24}?${ROLE_NOUN}`,
    `${ROLE_NOUN}[\\w\\s,&/'-]{0,24}?(?:${SOFTWARE_DOMAIN.join("|")})`,
  ].join("|"),
  "i",
);

// Never software, whatever else the title says. Recruiting sits here because
// "People Research Scientist, Recruiting" matched an explicit signal.
const HARD_OUT =
  /physical security|security guard|\btechnician\b|recruit|talent acquisition/i;

// Titles whose actual role noun is go-to-market. These beat an explicit
// software word — "Senior Customer Engineer, Cloudflare Developer Platform"
// is a customer engineer. Broader GTM wording is checked later, so
// "Software Engineer, GTM Platform" survives as the software job it is.
const HEAD_GTM = new RegExp(
  [
    "sales engineer","solutions? engineer","solution engineering",
    "customer engineer","customer engineering","solutions? architect",
    "field engineer","account (?:executive|manager|engineer|director)",
    "technical account","partner solutions?","sales manager",
    "(?:product|program|project|marketing|partnership|community|engagement) manager",
  ].join("|"),
  "i",
);

// Customer-facing roles that borrow engineering words.
const GO_TO_MARKET = new RegExp(
  [
    "\\bsales\\b","pre-?sales","post-?sales","\\bgtm\\b","go.to.market",
    "account (?:executive|manager|engineer|director)",
    "customer (?:success|solutions?|support|engineer|engineering)",
    "solutions? (?:architect|engineer|consultant|specialist|manager)",
    "solution engineering","field engineer","professional services",
    "technical account","partner (?:engineer|manager|solutions?)","channel",
    "business development","\\brevenue\\b","territory","enablement",
    "implementation (?:consultant|specialist)","onboarding specialist",
    "deal desk","renewals",
  ].join("|"),
  "i",
);

// Non-software engineering disciplines. SpaceX alone contributes hundreds.
const OTHER_DISCIPLINE = new RegExp(
  [
    "mechanical","chemical","civil","structural","electrical","electronics",
    "industrial","materials","metallurg","welding","machinist","manufactur",
    "fabrication","assembly","technician","avionics","propulsion",
    "aerodynamic","aerospace","thermal","fluid","hydraulic","pneumatic",
    "cryogenic","battery","antenna","\\brf\\b","rfic","mmic",
    "radio frequency","optical","photonic","laser","semiconductor","wafer",
    "solar cell","hardware","mechatronic","facilities","hvac",
    "architectural","surveyor","geotech","environmental","biolog","chemist",
    "clinical","pharma","nurse","physician","process engineer","design engineer",
  ].join("|"),
  "i",
);

// Functions that are not software.
const OTHER_FUNCTION = new RegExp(
  [
    "recruit","talent acquisition","people operations","\\bhr\\b",
    "human resources","compensation","benefits","payroll","workplace",
    "marketing","\\bbrand\\b","social media","content (?:writer|strateg)",
    "communications","public relations","\\bevent","legal","counsel",
    "paralegal","compliance","policy","finance","accounting","accountant",
    "controller","treasury","\\btax\\b","audit","procurement","fp&a",
    "investor relations","office manager","executive assistant",
    "administrative","customer service","technical writer",
    "instructional design","trust and safety","physical security",
    "regulatory","program manager","project manager","product manager",
    "product management","product designer","\\bdesigner\\b","\\bux\\b",
    "\\bui\\b","user research","data analyst","business analyst",
    "financial analyst","operations analyst","supply chain","logistics",
    "warehouse","facilities","real estate",
  ].join("|"),
  "i",
);

const SOFTWARE_TEAM =
  /^(?:software|engineering|platform|infrastructure|security|machine learning|data|research|technology|technical)/i;

const OTHER_TEAM =
  /^(?:sales|marketing|finance|legal|people|hardware|operations|customer|revenue|growth|go to market|professional services|business|solution|design|product|it$)/i;

/**
 * @param {{title?: string, team?: string|null}} job
 * @returns {boolean}
 */
export function isSoftwareRole({ title = "", team = null } = {}) {
  const text = String(title ?? "");
  if (!text.trim()) return false;

  const teamText = String(team ?? "").trim();

  // 1. Roles that are never software, and roles whose own noun is
  //    go-to-market, win over everything.
  if (HARD_OUT.test(text)) return false;
  if (HEAD_GTM.test(text)) return false;

  // 2. An explicit software title beats a non-software domain or function.
  if (EXPLICIT.test(text)) return true;

  // 3. Everything else that is plainly not software.
  if (GO_TO_MARKET.test(text)) return false;
  if (OTHER_DISCIPLINE.test(text)) return false;
  if (OTHER_FUNCTION.test(text)) return false;
  if (teamText && OTHER_TEAM.test(teamText)) return false;

  // 4. Weaker domain-near-role-noun signal, now that the obvious
  //    non-software titles are gone.
  if (DOMAIN_PROXIMITY.test(text)) return true;

  // 5. A generic engineering title ("Staff Engineer II") needs its team to
  //    vouch for it.
  if (teamText && SOFTWARE_TEAM.test(teamText) && /\bengineer/i.test(text)) {
    return true;
  }

  return false;
}
