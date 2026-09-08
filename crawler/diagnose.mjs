#!/usr/bin/env node
/**
 * Probes the endpoints the adapters rely on and prints what actually comes
 * back: status, content type, size and a snippet. Run it in CI (where the
 * network is open) whenever a source turns red or empty, so an adapter is
 * repaired against the real response instead of a guess.
 *
 *   node crawler/diagnose.mjs
 *   node crawler/diagnose.mjs pib mlh
 */
import { UA } from "./lib/core.mjs";

const TARGETS = {
  ctftime: [["events api", "https://ctftime.org/api/v1/events/?limit=2"]],
  hackerearth: [
    ["chrome-extension events", "https://www.hackerearth.com/chrome-extension/events/"],
    ["challenges page", "https://www.hackerearth.com/challenges/"],
    ["api hackathons", "https://www.hackerearth.com/api/challenges/?type=hackathon"],
  ],
  mlh: [
    ["season 2026", "https://mlh.io/seasons/2026/events"],
    ["season 2027", "https://mlh.io/seasons/2027/events"],
    ["root", "https://mlh.io/"],
  ],
  pib: [
    ["RssMain Regid=3", "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3"],
    ["RssMain no-www", "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3"],
    ["allRel listing", "https://www.pib.gov.in/allRel.aspx"],
    ["PressReleasePage", "https://www.pib.gov.in/PressReleasePage.aspx"],
    ["indexd", "https://www.pib.gov.in/indexd.aspx"],
  ],
  feeds: [
    ["SIH", "https://www.sih.gov.in/"],
    ["MyGov innovate", "https://innovateindia.mygov.in/"],
    ["MyGov tasks", "https://www.mygov.in/task/"],
    ["MeitY", "https://www.meity.gov.in/whats-new"],
    ["CERT-In", "https://www.cert-in.org.in/"],
    ["NCIIPC", "https://nciipc.gov.in/"],
    ["CTFtime RSS", "https://ctftime.org/event/list/upcoming/rss/"],
    ["Nullcon", "https://nullcon.net/"],
    ["c0c0n", "https://india.c0c0n.org/"],
    ["DSCI events", "https://www.dsci.in/events"],
    ["hackathon.com", "https://www.hackathon.com/theme/security"],
  ],
};

const argv = process.argv.slice(2);

/* --dump=<url> prints the repeating blocks of a listing page so a scraper can
   be written against the markup that is actually served, not a guess at it. */
const dump = (argv.find((a) => a.startsWith("--dump=")) || "").replace("--dump=", "");
if (dump) {
  await dumpBlocks(dump, Number((argv.find((a) => a.startsWith("--n=")) || "--n=2").replace("--n=", "")));
  process.exit(0);
}

const wanted = argv.filter((a) => !a.startsWith("--"));
const groups = wanted.length ? wanted : Object.keys(TARGETS);

for (const group of groups) {
  const targets = TARGETS[group];
  if (!targets) { console.log(`\n### ${group}: unknown group`); continue; }
  console.log(`\n### ${group}`);

  for (const [name, url] of targets) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
      });
      const body = await res.text();
      const ct = (res.headers.get("content-type") || "?").split(";")[0];
      console.log(`  ${name}`);
      console.log(`    ${res.status} ${ct} ${body.length}b ${Date.now() - t0}ms  final=${res.url !== url ? res.url : "(no redirect)"}`);
      console.log(`    shape: ${describe(body)}`);
      console.log(`    head : ${body.replace(/\s+/g, " ").slice(0, 260)}`);
    } catch (err) {
      console.log(`  ${name}\n    ERROR ${err.name}: ${err.message}`);
    }
  }
}

/** Cheap structural fingerprint, enough to tell an adapter what it is facing. */
function describe(body) {
  const bits = [];
  if (/^\s*[[{]/.test(body)) bits.push("json-ish");
  const items = (body.match(/<item\b/gi) || []).length;
  const entries = (body.match(/<entry\b/gi) || []).length;
  if (items || entries) bits.push(`feed(items=${items},entries=${entries})`);
  const links = (body.match(/<a\b[^>]*href=/gi) || []).length;
  if (links) bits.push(`links=${links}`);
  for (const cls of ["event", "card", "hackathon", "challenge", "press", "release", "notice"]) {
    const n = (body.match(new RegExp(`class=["'][^"']*\\b${cls}`, "gi")) || []).length;
    if (n) bits.push(`.${cls}=${n}`);
  }
  if (/cloudflare|captcha|are you a robot|access denied/i.test(body)) bits.push("BLOCKED?");
  if (/__NEXT_DATA__|window\.__NUXT__|ng-version/i.test(body)) bits.push("client-rendered(SPA)");
  return bits.join(" ") || "plain";
}

/**
 * Print the first few repeating "card" blocks of a listing page, plus any
 * JSON-LD, so an adapter can be written against real markup.
 */
async function dumpBlocks(url, count) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const html = await res.text();
  console.log(`# ${url}\n  ${res.status} ${res.headers.get("content-type")} ${html.length}b final=${res.url}\n`);

  const ld = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (ld.length) {
    console.log(`## JSON-LD blocks: ${ld.length}`);
    console.log(ld[0][1].replace(/\s+/g, " ").slice(0, 1200), "\n");
  }

  // Which class token repeats most? That is almost always the card wrapper.
  const freq = {};
  for (const m of html.matchAll(/class=["']([^"']+)["']/gi)) {
    for (const tok of m[1].split(/\s+/)) {
      if (tok.length > 2 && !/^(row|col|container|wrapper|flex|grid|text|bg|p|m|w|h)-?\d*$/.test(tok)) {
        freq[tok] = (freq[tok] || 0) + 1;
      }
    }
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 22);
  console.log("## most repeated class tokens");
  console.log("  " + top.map(([k, v]) => `${k}(${v})`).join("  "), "\n");

  for (const token of ["event", "card", "challenge", "hackathon", "listing", "post"]) {
    const re = new RegExp(`<(\\w+)[^>]*class=["'][^"']*\\b${token}\\b[^"']*["'][^>]*>`, "gi");
    const hits = [...html.matchAll(re)];
    if (!hits.length) continue;
    console.log(`## blocks whose class contains "${token}" (${hits.length})`);
    for (const h of hits.slice(0, count)) {
      console.log("  ---");
      console.log("  " + html.slice(h.index, h.index + 3200).replace(/\s+/g, " "));
    }
    console.log();
  }
}
