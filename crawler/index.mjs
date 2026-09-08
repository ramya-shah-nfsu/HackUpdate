#!/usr/bin/env node
/**
 * HackUpdate daily crawl.
 *
 *   node crawler/index.mjs            # full run, writes data/events.json
 *   node crawler/index.mjs --dry-run  # run sources, print a report, write nothing
 *   node crawler/index.mjs --only=ctftime,pib
 *
 * Design notes:
 *  - Every source is isolated. One failing adapter degrades the run, it never
 *    fails it, and the failure is recorded in the published `sources` report so
 *    a broken scrape is visible on the portal instead of silently thinning it.
 *  - The previous data/events.json is merged in, so an event survives a day
 *    when its source is down. Records older than `keepPastDays` are dropped.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalize, dedupe } from "./lib/normalize.mjs";
import { classify, DOMAINS, UNCLASSIFIED } from "./lib/classify.mjs";
import { log } from "./lib/core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "data", "events.json");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "crawler", "config", "sources.json"), "utf8"));

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);

const ADAPTERS = ["curated", "ctftime", "devpost", "unstop", "devfolio", "hackerearth", "mlh", "mygov", "pib", "feeds"];

async function run() {
  const started = Date.now();
  const settings = CONFIG.settings;
  console.log(`HackUpdate crawl: ${new Date().toISOString()}${DRY_RUN ? " (dry run)" : ""}`);

  const collected = [];
  const report = [];

  for (const name of ADAPTERS) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    if (CONFIG.adapters?.[name]?.enabled === false) {
      report.push({ id: name, status: "disabled", count: 0 });
      continue;
    }

    log.step(`source: ${name}`);
    const t0 = Date.now();
    try {
      const mod = await import(`./sources/${name}.mjs`);
      const options =
        name === "feeds"
          ? { feeds: CONFIG.feeds || [], maxPerSource: settings.maxFeedItemsPerSource }
          : { windowDays: settings.windowDays };

      const raw = await mod.fetchEvents(options);
      const normalized = raw.map((r) => normalize(r, mod.meta)).filter(Boolean);
      collected.push(...normalized);

      log.ok(`${normalized.length} event(s) in ${Date.now() - t0}ms`);
      report.push({
        id: name,
        label: mod.meta.label,
        homepage: mod.meta.homepage,
        status: normalized.length ? "ok" : "empty",
        count: normalized.length,
        ms: Date.now() - t0,
      });
    } catch (err) {
      log.fail(`${name} failed: ${err.message}`);
      report.push({ id: name, status: "error", count: 0, error: String(err.message).slice(0, 300), ms: Date.now() - t0 });
    }
  }

  /* ---------------------------- merge & filter ---------------------------- */

  const previous = loadPrevious();
  log.step("merging");
  log.info(`${collected.length} fresh + ${previous.length} carried over from the last run`);

  const merged = dedupe([...collected, ...previous.map((e) => classify(e))]);

  const cutoff = Date.now() - settings.keepPastDays * 86400000;
  const horizon = Date.now() + settings.windowDays * 86400000;

  const kept = merged
    // Trusted (curated) records bypass scoring entirely. An undated entry scores
    // near zero by design, so without this a hand-added programme awaiting its
    // calendar would be dropped by the very threshold meant to filter scrapes.
    .filter((e) => e.trusted || e.relevance >= settings.minScore)
    // A hackathon that matched no domain is a generic college event, not one of
    // ours. CTFs are exempt: a capture the flag is a security competition even
    // when its blurb never says so.
    .filter((e) => {
      if (!settings.requireDomainMatch) return true;
      if (e.trusted || e.type === "ctf") return true;
      return !(e.domains.length === 1 && e.domains[0] === UNCLASSIFIED);
    })
    .filter((e) => {
      const end = e.endsAt || e.startsAt;
      // A curated entry may legitimately have no date yet: a programme is often
      // announced months before its calendar is published. Everything crawled
      // still needs one, because an undated scrape is noise.
      if (!end) return e.trusted === true;
      const t = +new Date(end);
      return t >= cutoff && +new Date(e.startsAt || end) <= horizon;
    })
    .sort(byRelevanceThenDate)
    .slice(0, settings.maxEvents);

  const dropped = merged.length - kept.length;
  const offTopic = merged.filter((e) => !e.trusted && e.type !== "ctf" && e.domains.length === 1 && e.domains[0] === UNCLASSIFIED).length;
  log.ok(`${kept.length} published, ${dropped} filtered out (${offTopic} off-topic, rest below score ${settings.minScore}, undated or finished)`);

  const payload = {
    generatedAt: new Date().toISOString(),
    generatorVersion: 2,
    runMs: Date.now() - started,
    counts: summarize(kept),
    domains: DOMAINS,
    sources: report,
    events: kept,
  };

  printSummary(payload);

  if (DRY_RUN) {
    log.warn("dry run: data/events.json not written");
    return;
  }
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  log.ok(`wrote ${OUT_FILE}`);
}

/** Soonest useful events first, with relevance breaking ties. */
function byRelevanceThenDate(a, b) {
  const rank = { ongoing: 0, upcoming: 1, past: 2, undated: 3 };
  if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
  const at = +new Date(a.startsAt || a.endsAt || 0);
  const bt = +new Date(b.startsAt || b.endsAt || 0);
  if (at !== bt) return at - bt;
  return b.relevance - a.relevance;
}

function loadPrevious() {
  if (!existsSync(OUT_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(OUT_FILE, "utf8"));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch (err) {
    log.warn(`could not read the previous data file (${err.message}); starting fresh`);
    return [];
  }
}

function summarize(events) {
  const tally = (fn) => events.reduce((acc, e) => {
    for (const k of [].concat(fn(e))) acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  return {
    total: events.length,
    byType: tally((e) => e.type),
    byScope: tally((e) => e.scope),
    byStatus: tally((e) => e.status),
    byDomain: tally((e) => e.domains),
    bySource: tally((e) => e.source),
  };
}

function printSummary({ counts, sources }) {
  log.step("summary");
  console.log(`   total ${counts.total}`);
  for (const [label, obj] of [["type", counts.byType], ["scope", counts.byScope], ["status", counts.byStatus]]) {
    console.log(`   ${label.padEnd(7)} ${Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("  ") || "-"}`);
  }
  console.log("   domains " + Object.entries(counts.byDomain).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
  console.log("   sources " + sources.map((s) => `${s.id}:${s.status}(${s.count})`).join("  "));
  const broken = sources.filter((s) => s.status === "error");
  if (broken.length) {
    log.warn(`${broken.length} source(s) failed this run:`);
    for (const b of broken) console.log(`     - ${b.id}: ${b.error}`);
  }
}

run().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
