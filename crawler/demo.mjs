#!/usr/bin/env node
/**
 * Writes a synthetic feed so the portal can be styled and tested without
 * network access. FOR LOCAL UI WORK ONLY: every record is fabricated and is
 * labelled as such. Never commit its output.
 *
 *   node crawler/demo.mjs            -> data/events.json  (overwrites!)
 *   node crawler/demo.mjs out.json   -> a file of your choosing
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { normalize, dedupe } from "./lib/normalize.mjs";
import { DOMAINS } from "./lib/classify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] || join(ROOT, "data", "events.json"));

const day = (n) => new Date(Date.now() + n * 864e5).toISOString();

const SAMPLES = [
  ["National Digital Forensics Challenge", "A three-round disk, memory and mobile forensics competition for postgraduate students. Teams reconstruct a simulated intrusion, recover deleted artefacts and present a chain-of-custody report to a panel of investigators.", "ctf", 18, 20, 12, "Gandhinagar, Gujarat", "India", "₹3,00,000", "onsite"],
  ["Drone Forensics and Counter-UAS Sprint", "Participants analyse flight controller firmware and telemetry logs recovered from a seized UAV, then build a counter-UAS detection prototype. Hardware kits are provided on site.", "hackathon", 34, 36, 26, "New Delhi", "India", "₹5,00,000", "onsite"],
  ["Smart India Hackathon: Cyber Security Edition", "The software edition problem statements cover critical information infrastructure, secure identity and law-enforcement tooling. Open to all AICTE-affiliated institutions.", "hackathon", 61, 63, 40, "Multiple nodal centres, India", "India", "₹1,00,000 per winning team", "hybrid"],
  ["Cyber Kushti National CTF", "A jeopardy-style capture the flag announced through a Press Information Bureau release, focused on incident response, OSINT and malware analysis for police and student teams.", "ctf", 9, 10, 4, "Online, India", "India", "", "online"],
  ["OT and ICS Security Grand Challenge", "A live SCADA testbed with Modbus and IEC 61850 traffic. Blue teams defend a simulated substation while red teams attempt to trip the breakers.", "hackathon", 47, 49, 38, "Bengaluru", "India", "₹8,00,000", "onsite"],
  ["IoT Firmware Reverse Engineering CTF", "Attack a fleet of consumer smart devices: extract firmware over UART, defeat secure boot, and pivot into the cloud API. Beginner track included.", "ctf", 26, 27, 20, "Online", "", "$5,000", "online"],
  ["Global Adversarial AI Hackathon", "Build and break machine learning systems: prompt injection, model extraction, deepfake detection and adversarial robustness. Compute credits provided.", "hackathon", 15, 18, 8, "Online, worldwide", "", "$25,000", "online"],
  ["Critical Infrastructure Resilience Datathon", "Open telemetry from power, water and rail operators. Teams model cascading failures and propose detection strategies for cyber-physical attacks.", "hackathon", 72, 74, 55, "Amsterdam, Netherlands", "Netherlands", "€15,000", "hybrid"],
  ["University Capture the Flag Championship", "An international student CTF with pwn, web, crypto and forensics categories. Top teams qualify for the on-site final.", "ctf", 3, 5, -1, "Online", "", "$10,000", "online"],
  ["Blockchain and Wallet Security Challenge", "Audit intentionally vulnerable smart contracts and wallet clients, then submit a written disclosure report.", "ctf", 41, 43, 33, "Online", "", "$12,000", "online"],
  ["Police Cyber Innovation Hackathon", "State police cyber cells set the problem statements: dark-web monitoring, financial-fraud tracing and digital evidence triage at scale.", "hackathon", 55, 57, 44, "Kochi, Kerala", "India", "₹4,00,000", "onsite"],
  ["Cloud and DevSecOps Attack Simulation", "A 48-hour purple-team exercise across Kubernetes, CI/CD supply chain and cloud IAM misconfiguration.", "ctf", -1, 1, -6, "Online", "", "$8,000", "online"],
];

const events = SAMPLES.map(([title, description, type, start, end, regClose, place, country, prize, mode], i) =>
  normalize(
    {
      sourceId: `demo-${i}`,
      type,
      title,
      description,
      url: `https://example.org/demo/${i + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: `https://example.org/listing/${i + 1}`,
      image: "",
      organizer: country === "India" ? "Demo Organiser, India" : "Demo Organiser (International)",
      prize,
      rules: [
        "SAMPLE DATA: this record is fabricated for local interface testing and is not a real event.",
        "Teams of up to four; at least one member must be a currently enrolled student.",
        "Bring your own laptop. Network access is provided at the venue.",
      ],
      eligibility: "Open to enrolled undergraduate and postgraduate students.",
      startsAt: day(start),
      endsAt: day(end),
      registration: { closesAt: day(regClose), url: `https://example.org/demo/${i + 1}/register` },
      participants: 120 + i * 37,
      location: { text: place, country, mode },
      tags: ["Sample data", type === "ctf" ? "CTF" : "Hackathon"],
    },
    { id: "demo", label: "DEMO (fabricated sample data)" }
  )
).filter(Boolean);

const kept = dedupe(events);
const tally = (fn) => kept.reduce((a, e) => { for (const k of [].concat(fn(e))) a[k] = (a[k] || 0) + 1; return a; }, {});

writeFileSync(out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  generatorVersion: 2,
  demo: true,
  runMs: 0,
  counts: {
    total: kept.length,
    byType: tally((e) => e.type),
    byScope: tally((e) => e.scope),
    byStatus: tally((e) => e.status),
    byDomain: tally((e) => e.domains),
    bySource: tally((e) => e.source),
  },
  domains: DOMAINS,
  sources: [
    { id: "demo", label: "DEMO (fabricated sample data)", homepage: "", status: "ok", count: kept.length, ms: 0 },
    { id: "ctftime", label: "CTFtime", homepage: "https://ctftime.org/", status: "error", count: 0, error: "not run in demo mode" },
  ],
  events: kept,
}, null, 2) + "\n");

console.log(`Wrote ${kept.length} fabricated demo events to ${out}`);
console.log("Reminder: this is sample data. Run `node crawler/index.mjs` for the real feed.");
