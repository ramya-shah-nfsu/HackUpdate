#!/usr/bin/env node
/**
 * Gate between the crawl and the portal. Run in CI right after the crawl:
 * a malformed or suspiciously empty feed fails the job instead of shipping.
 *
 *   node crawler/validate.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "events.json");

const errors = [];
const warnings = [];

if (!existsSync(FILE)) {
  console.error("FAIL: data/events.json does not exist. Run: node crawler/index.mjs");
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(FILE, "utf8"));
} catch (err) {
  console.error(`FAIL: data/events.json is not valid JSON (${err.message})`);
  process.exit(1);
}

/* ------------------------------- envelope -------------------------------- */
for (const key of ["generatedAt", "counts", "sources", "events"]) {
  if (!(key in data)) errors.push(`missing top-level key "${key}"`);
}
if (!Array.isArray(data.events)) errors.push("events is not an array");
if (data.generatedAt && Number.isNaN(+new Date(data.generatedAt))) errors.push("generatedAt is not a valid date");

/* -------------------------------- records -------------------------------- */
const seenIds = new Set();
const events = Array.isArray(data.events) ? data.events : [];

events.forEach((e, i) => {
  const at = `events[${i}]${e?.title ? ` "${String(e.title).slice(0, 48)}"` : ""}`;
  if (!e || typeof e !== "object") return errors.push(`${at}: not an object`);
  if (!e.id) errors.push(`${at}: no id`);
  else if (seenIds.has(e.id)) errors.push(`${at}: duplicate id ${e.id}`);
  else seenIds.add(e.id);

  if (!e.title) errors.push(`${at}: no title`);
  if (!["ctf", "hackathon"].includes(e.type)) errors.push(`${at}: type is "${e.type}"`);
  if (!["national", "international"].includes(e.scope)) errors.push(`${at}: scope is "${e.scope}"`);
  if (!Array.isArray(e.domains) || !e.domains.length) errors.push(`${at}: no domains`);

  // The portal only ever renders http(s) links; anything else is a red flag.
  for (const [field, value] of [["url", e.url], ["sourceUrl", e.sourceUrl], ["image", e.image]]) {
    if (value && !/^https?:\/\//i.test(value)) errors.push(`${at}: ${field} is not an http(s) URL (${String(value).slice(0, 60)})`);
  }
  if (e.startsAt && Number.isNaN(+new Date(e.startsAt))) errors.push(`${at}: startsAt is not a valid date`);
  if (!e.url && !e.sourceUrl) warnings.push(`${at}: no link a student can open`);
  if (!e.startsAt) warnings.push(`${at}: no start date`);
});

/* --------------------------- run-quality checks --------------------------- */
const sources = Array.isArray(data.sources) ? data.sources : [];
const failed = sources.filter((s) => s.status === "error");
const working = sources.filter((s) => s.status === "ok");

if (sources.length && !working.length) {
  errors.push("every source failed this run; refusing to publish an empty feed");
}
for (const s of failed) warnings.push(`source "${s.id}" failed: ${s.error}`);

if (!events.length) warnings.push("the feed contains zero events");

/* --------------------------------- report -------------------------------- */
console.log(`Validating data/events.json`);
console.log(`  generated : ${data.generatedAt}`);
console.log(`  events    : ${events.length}`);
console.log(`  sources   : ${working.length} ok, ${failed.length} failed, ${sources.length} total`);
console.log(`  types     : ${JSON.stringify(data.counts?.byType ?? {})}`);
console.log(`  scope     : ${JSON.stringify(data.counts?.byScope ?? {})}`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 25)) console.log(`  ! ${w}`);
  if (warnings.length > 25) console.log(`  … ${warnings.length - 25} more`);
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors.slice(0, 40)) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log("\nOK: the feed is well formed and safe to publish.");
