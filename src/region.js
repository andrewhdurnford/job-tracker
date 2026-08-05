/**
 * Work out whether a posting is in the US, in Canada, or remote.
 *
 * Two signal sources, in order of trust:
 *   1. Structured country data. Ashby exposes address.postalAddress.addressCountry
 *      per location; Lever exposes an ISO-3166 alpha-2 `country`. Greenhouse
 *      exposes nothing at all, which is why the string parsing below exists.
 *   2. The location string, parsed against country/state/province/city tables.
 *
 * Tuned against 1,981 distinct location strings from 100 live boards. The
 * formats in the wild are wildly inconsistent: "Hawthorne, CA", "San
 * Francisco", "US-CA-Menlo Park", "San Francisco, CA • New York, NY • United
 * States", "Remote - USA", "DE-Germany-Remote", "Canada - Remote (ON, AB, BC,
 * or NS Only)", "BLANK,BLANK,Multiple Locations".
 */

export const REGIONS = ["us", "canada", "remote"];

const US_STATE_ABBR = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const US_STATE_NAMES = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut",
  "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa",
  "kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan",
  "minnesota","mississippi","missouri","montana","nebraska","nevada",
  "new hampshire","new jersey","new mexico","new york","north carolina",
  "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
  "south carolina","south dakota","tennessee","texas","utah","vermont",
  "virginia","washington","west virginia","wisconsin","wyoming",
  "district of columbia",
]);

// Two-letter province codes are matched as uppercase tokens only, so the
// English word "on" never reads as Ontario.
const CA_PROVINCE_ABBR = new Set([
  "ON","BC","QC","AB","MB","SK","NS","NB","NL","PE","YT","NT","NU",
]);

const CA_PROVINCE_NAMES = new Set([
  "ontario","british columbia","quebec","québec","alberta","manitoba",
  "saskatchewan","nova scotia","new brunswick","newfoundland",
  "newfoundland and labrador","prince edward island","yukon",
  "northwest territories","nunavut",
]);

const CA_CITIES = new Set([
  "toronto","vancouver","montreal","montréal","ottawa","calgary","edmonton",
  "waterloo","kitchener","winnipeg","halifax","mississauga","brampton",
  "burnaby","richmond hill","markham","victoria","saskatoon","regina",
  "quebec city","kelowna","guelph","sherbrooke","laval",
]);

// Bare US city names, for boards that omit the state entirely ("San
// Francisco", "Chicago", "Boston"). An explicit state or country token always
// wins over this list, so "London, KY" still reads as the US.
const US_CITIES = new Set([
  "san francisco","sf","san francisco bay area","sf bay area","bay area",
  "new york","new york city","nyc","brooklyn","chicago","boston","seattle",
  "austin","denver","atlanta","los angeles","la","san diego","washington",
  "washington dc","dallas","houston","philadelphia","phoenix","miami",
  "portland","nashville","detroit","minneapolis","pittsburgh","salt lake city",
  "bellevue","redmond","palo alto","mountain view","menlo park","sunnyvale",
  "santa clara","san jose","cupertino","irvine","boulder","san mateo",
  "foster city","santa monica","culver city","oakland","berkeley","sacramento",
  "san antonio","charlotte","raleigh","durham","chapel hill","columbus",
  "indianapolis","kansas city","st louis","saint louis","milwaukee",
  "cleveland","cincinnati","baltimore","richmond","orlando","tampa",
  "jacksonville","las vegas","tucson","albuquerque","omaha","des moines",
  "madison","ann arbor","provo","reno","boise","hawthorne","bastrop",
  "starbase","cape canaveral","mcgregor","brownsville","vandenberg",
  "el segundo","torrance","fremont","santa barbara","long beach","pasadena",
  "irving","plano","arlington","alexandria","mclean","reston","herndon",
  "bethesda","somerville","waltham","new haven","stamford","princeton",
  "hoboken","jersey city","white plains","tempe","scottsdale","chandler",
  "mesa","sterling","ashburn","frisco","addison","westlake","santa cruz",
]);

// Countries and macro-regions that are neither the US nor Canada. Checked
// BEFORE state abbreviations, because a country prefix such as "DE-Germany-
// Remote" would otherwise match DE = Delaware.
const FOREIGN_COUNTRIES = [
  "united kingdom","uk","gb","great britain","england","scotland","wales",
  "northern ireland","ireland","eire","france","germany","deutschland","spain",
  "portugal","italy","netherlands","holland","belgium","luxembourg",
  "switzerland","austria","sweden","norway","denmark","finland","iceland",
  "poland","czechia","czech republic","slovakia","hungary","romania",
  "bulgaria","greece","croatia","serbia","slovenia","estonia","latvia",
  "lithuania","ukraine","turkey","cyprus","malta","israel",
  "united arab emirates","uae","saudi arabia","ksa","qatar","kuwait","bahrain",
  "egypt","south africa","nigeria","kenya","ghana","morocco","india","ind",
  "pakistan","bangladesh","sri lanka","nepal","china","prc","hong kong",
  "macau","taiwan","japan","jpn","south korea","north korea","korea",
  "singapore","sg","malaysia","indonesia","thailand","vietnam","philippines",
  "australia","aus","new zealand","mexico","mx","brazil","brasil","argentina",
  "chile","colombia","peru","uruguay","ecuador","bolivia","paraguay",
  "venezuela","costa rica","panama","guatemala","dominican republic","russia",
  "kazakhstan","armenia","georgia country","azerbaijan",
  "emea","apac","apj","latam","latin america","europe","european union","eu",
  "asia","asia pacific","middle east","africa","oceania","anz","benelux",
  "dach","nordics","iberia",
];

// Ambiguous city names live here on purpose: in these feeds "London",
// "Cambridge" and "Birmingham" are overwhelmingly the non-US ones. Checked
// AFTER US state tokens, so "London, KY" still resolves to the US.
const FOREIGN_CITIES = [
  "london","paris","dublin","cork","galway","amsterdam","rotterdam","berlin",
  "munich","münchen","hamburg","frankfurt","cologne","köln","stuttgart",
  "düsseldorf","dusseldorf","dresden","leipzig","zurich","zürich","geneva",
  "basel","lausanne","stockholm","gothenburg","copenhagen","oslo","helsinki",
  "madrid","barcelona","valencia","seville","lisbon","porto","milan","rome",
  "turin","naples","warsaw","kraków","krakow","wrocław","wroclaw","gdańsk",
  "gdansk","poznań","poznan","prague","brno","bratislava","budapest",
  "bucharest","sofia","athens","thessaloniki","vienna","brussels","antwerp",
  "tallinn","vilnius","riga","kyiv","kiev","istanbul","ankara","tel aviv",
  "jerusalem","haifa","herzliya","dubai","abu dhabi","riyadh","doha","cairo",
  "nairobi","lagos","accra","casablanca","cape town","johannesburg","pretoria",
  "bengaluru","bangalore","hyderabad","mumbai","delhi","new delhi","gurugram",
  "gurgaon","noida","pune","chennai","kolkata","ahmedabad","karachi","lahore",
  "dhaka","colombo","shanghai","beijing","shenzhen","guangzhou","hangzhou",
  "tokyo","osaka","kyoto","yokohama","seoul","busan","taipei","kuala lumpur",
  "jakarta","bangkok","manila","cebu","ho chi minh city","saigon","hanoi",
  "sydney","melbourne","brisbane","perth","adelaide","canberra","auckland",
  "wellington","christchurch","mexico city","guadalajara","monterrey",
  "são paulo","sao paulo","rio de janeiro","porto alegre","belo horizonte",
  "brasília","brasilia","buenos aires","córdoba","cordoba","bogotá","bogota",
  "medellín","medellin","santiago","lima","montevideo","glasgow","edinburgh",
  "manchester","bristol","leeds","liverpool","belfast","toulouse","lyon",
  "marseille","nantes","bordeaux","lille","nice",
];

// "North America" spans both countries we track.
const MULTI = new Map([["north america", ["us", "canada"]]]);

const REMOTE_RE = /\b(remote|work from home|wfh|distributed|anywhere)\b/i;
const US_TOKEN_RE = /\b(u\.?s\.?a?\.?|united states|usa)\b/i;
const CA_TOKEN_RE = /\bcanada\b/i;

// Splits multi-location strings: "SF • NYC", "A; B", "A | B", "A or B".
// "or"/"and" are matched lower-case only — an upper-case OR is Oregon.
const PART_SPLIT_RE = /\s*[•|;]\s*|\s+(?:or|and)\s+/;

// Location strings that carry a work arrangement or a placeholder instead of a
// place. Distinguishing these from "a real place we could not resolve" matters:
// only the former justifies falling back to another field.
const VAGUE_RE =
  /^(?:in-?office|hybrid|remote|distributed|anywhere|n\/?a|none|tbd|multiple locations|.*\bblank\b.*)$/i;

export function isVagueLocation(value) {
  const text = String(value ?? "").trim();
  return text === "" || VAGUE_RE.test(text);
}

/**
 * @param {{locations?: string[], countries?: string[]}} input
 * @returns {string[]} some subset of ["us", "canada", "remote"]; empty means
 *   the posting is in none of them and should be dropped.
 */
export function regionsFor({ locations = [], countries = [] } = {}) {
  const found = new Set();

  for (const country of countries) {
    const region = countryRegion(country);
    if (region) found.add(region);
  }

  for (const location of locations) {
    for (const part of String(location ?? "").split(PART_SPLIT_RE)) {
      for (const region of regionsForPart(part)) found.add(region);
    }
  }

  return REGIONS.filter((r) => found.has(r));
}

/**
 * Ashby gives country names ("United States", "USA", "Canada"); Lever gives
 * ISO-3166 alpha-2 ("US", "CA", "GB"). Two-letter values are read as ISO,
 * which is the only context where a bare "CA" means Canada rather than
 * California.
 */
export function countryRegion(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (/^[A-Za-z]{2}$/.test(text)) {
    const code = text.toUpperCase();
    if (code === "US") return "us";
    if (code === "CA") return "canada";
    return null; // any other ISO code is a country we do not track
  }

  if (US_TOKEN_RE.test(text)) return "us";
  if (CA_TOKEN_RE.test(text)) return "canada";
  return null;
}

function regionsForPart(part) {
  const text = String(part ?? "").trim();
  if (!text) return [];

  // 1. Workday-style "CC-Region-City" ("US-CA-Menlo Park", "CA-Ontario-Toronto",
  //    "IN-Pune", "GB-London"). The leading code is always ISO country here —
  //    never a US state — so it settles the question outright.
  const prefix = text.match(/^([A-Z]{2})-/);
  if (prefix) {
    const region = countryRegion(prefix[1]);
    return region ? [region] : [];
  }

  // 2. Explicit country beats everything, including a remote qualifier:
  //    "Remote - USA" is a US role, "Remote (Canada)" a Canadian one.
  if (US_TOKEN_RE.test(text)) return ["us"];
  if (CA_TOKEN_RE.test(text)) return ["canada"];

  const multi = MULTI.get(text.toLowerCase().trim());
  if (multi) return multi;

  // 2. Foreign country names, before any state matching. "DE-Germany-Remote"
  //    must not read DE as Delaware.
  if (containsAny(text, FOREIGN_COUNTRIES)) return [];

  const tokens = tokenize(text);

  // 3. Canada before the US: "Toronto, ON, CA" is Ontario, not California.
  if (tokens.some((t) => isCode(t) && CA_PROVINCE_ABBR.has(t.raw))) return ["canada"];
  if (tokens.some((t) => CA_PROVINCE_NAMES.has(t.lower))) return ["canada"];
  if (tokens.some((t) => CA_CITIES.has(t.lower))) return ["canada"];

  // 4. US states.
  if (tokens.some((t) => isCode(t) && US_STATE_ABBR.has(t.raw))) return ["us"];
  if (tokens.some((t) => US_STATE_NAMES.has(t.lower))) return ["us"];

  // 5. Ambiguous foreign cities, only now that no US state has claimed it.
  if (containsAny(text, FOREIGN_CITIES)) return [];

  if (tokens.some((t) => US_CITIES.has(t.lower))) return ["us"];

  // 6. Unqualified "Remote" / "Distributed": no country to contradict it.
  if (REMOTE_RE.test(text)) return ["remote"];

  return [];
}

// Whole-token containment: "-REMOTE, BULGARIA-" and "Remote (Portugal)" must
// both match, while "Indiana" must not match "india".
function containsAny(text, needles) {
  const lower = text.toLowerCase();
  return needles.some((needle) => {
    const at = lower.indexOf(needle);
    if (at === -1) return false;
    const before = lower[at - 1];
    const after = lower[at + needle.length];
    return !isWordChar(before) && !isWordChar(after);
  });
}

function isWordChar(char) {
  return char !== undefined && /[a-z0-9]/.test(char);
}

/**
 * A two-letter token only counts as a state/province code when the source
 * wrote it in caps. Otherwise "In-Office" reads as Indiana and "Hybrid or
 * Remote" would be anything at all.
 */
function isCode(token) {
  return token.original.length === 2 && token.original === token.raw;
}

// Splits on commas and dashes so "US-CA-Menlo Park" and "New York, NY" both
// surface their state token. Keeps original case for code matching.
function tokenize(text) {
  return text
    .split(/[,\-–—()]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({
      original: t,
      raw: t.toUpperCase(),
      lower: t.toLowerCase().replace(/\./g, ""),
    }));
}
