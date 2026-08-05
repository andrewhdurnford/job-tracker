const USER_AGENT =
  "job-tracker/1.0 (personal job posting watcher; +https://github.com/)";

const TIMEOUT_MS = 15_000;

/** GET a URL and parse JSON. Throws on timeout, network error, or non-2xx. */
export async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError") throw new Error(`timeout after ${TIMEOUT_MS}ms`);
    throw new Error(`network error: ${err.message}`);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  try {
    return await res.json();
  } catch {
    throw new Error("response was not valid JSON");
  }
}

/** POST a JSON body and parse the JSON response. Same failure modes as fetchJson. */
export async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError") throw new Error(`timeout after ${TIMEOUT_MS}ms`);
    throw new Error(`network error: ${err.message}`);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  try {
    return await res.json();
  } catch {
    throw new Error("response was not valid JSON");
  }
}
