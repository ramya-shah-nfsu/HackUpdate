/**
 * Entries maintained by hand in data/curated.json.
 *
 * Why this exists: several Government of India sites that announce the most
 * relevant national programmes (PIB, MeitY, SIH, CERT-In, NCIIPC) refuse
 * requests from data-centre IP ranges, so a crawler running on GitHub's
 * runners is served "Access Denied" no matter how it asks. Rather than pretend
 * those sources work, the department adds those few events here by hand.
 *
 * A curated record is trusted: it skips the relevance gate and may omit dates,
 * because a person vouched for it. If the same event is later picked up
 * automatically, deduplication merges the two into one enriched entry.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "curated.json");

export const meta = {
  id: "curated",
  label: "Curated by NFSU",
  homepage: "",
  kind: "manual",
  produces: "mixed",
  trusted: true,
};

export async function fetchEvents() {
  if (!existsSync(FILE)) return [];

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(FILE, "utf8"));
  } catch (err) {
    throw new Error(`data/curated.json is not valid JSON: ${err.message}`);
  }

  const rows = Array.isArray(parsed) ? parsed : parsed.events;
  if (!Array.isArray(rows)) throw new Error('data/curated.json must have an "events" array');

  return rows
    .filter((r) => r && r.title && r.published !== false)
    .map((r, i) => ({
      ...r,
      sourceId: `curated-${r.id || r.url || i}`,
      sourceUrl: r.sourceUrl || r.url || "",
      trusted: true,
      tags: [...(r.tags || []), "Curated by NFSU"],
      rules: [
        ...(r.rules || []),
        "This entry is maintained by the department because the announcing site cannot be crawled. Confirm the current details on the official page.",
      ],
    }));
}
