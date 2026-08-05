import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runPoll, report } from "./poll-core.js";
import { sendDigest } from "./notify.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, "companies.json");
const STATE_PATH = resolve(ROOT, "data/state.json");
const FEED_PATH = resolve(ROOT, "data/jobs.json");

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const previousState = await readState();
  const now = new Date().toISOString();

  const {
    state,
    feed,
    jobs,
    allNew,
    allRemoved,
    alertable,
    summary,
    skipped,
    bootstrap,
    maxAgeDays,
  } = await runPoll(config, previousState, now);

  await mkdir(dirname(FEED_PATH), { recursive: true });
  await writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + "\n");
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n");

  const mail = await sendDigest(alertable, { bootstrap });
  report({
    bootstrap,
    jobs,
    allNew,
    allRemoved,
    summary,
    mail,
    muted: allNew.length - alertable.length,
    skipped,
    maxAgeDays,
  });
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null; // first run
    throw new Error(`data/state.json exists but is unreadable: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`poll failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
