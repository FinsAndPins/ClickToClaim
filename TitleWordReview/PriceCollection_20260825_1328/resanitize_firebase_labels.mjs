/**
 * Re-sanitize every Firebase label (strip LE numbers / Chaser) and bump rules_version.
 * Usage: node resanitize_firebase_labels.mjs [--dry-run]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry-run");
const DB =
  "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com/title_word_review/PriceCollection_20260825_1328/batch_full_98_v1/pins.json";
const RULES_VERSION = "v7_sanitize_le2";
const BATCH_ID = "batch_full_98_v1";
const COLLECTION = "PriceCollection_20260825_1328";

function safePk(pinKey) {
  return String(pinKey || "").replace(/[.#$/\[\]]/g, "_");
}

function loadTitleSeed() {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "title_seed.js"), "utf8"), {
    filename: "title_seed.js",
  });
  return globalThis.TitleSeed;
}

function makeSeedLabel(pin, TitleSeed, rules) {
  const tokens = TitleSeed.tokenize(pin.ebay_title);
  const order = TitleSeed.seedSuggestion(tokens, rules);
  const cleaned = TitleSeed.titleFromOrder(tokens, order, rules);
  return { tokens, order, cleaned };
}

function includedTokens(label) {
  const byId = Object.fromEntries((label.tokens || []).map((t) => [t.id, t]));
  return (label.include_order || []).map((id) => byId[id]).filter(Boolean);
}

function labelPayload(label) {
  return {
    pin_key: label.pin_key,
    crop_filename: label.crop_filename,
    ebay_title: label.ebay_title,
    cleaned_title: label.cleaned_title,
    include_order: label.include_order,
    tokens: (label.tokens || []).map((t) => ({
      id: t.id,
      text: t.text,
      key: t.key,
      state: t.state,
      desc_only: !!t.desc_only,
    })),
    included_words_ordered: includedTokens(label).map((t) => t.text),
    description_only_words: (label.tokens || [])
      .filter((t) => t.desc_only && t.state === "never")
      .map((t) => t.text),
    accepted: !!label.accepted,
    reviewed_by: label.reviewed_by || "",
    updated_at: label.updated_at,
    accepted_at: label.accepted_at || null,
    batch_id: BATCH_ID,
    collection: COLLECTION,
    rules_version: RULES_VERSION,
  };
}

async function main() {
  const TitleSeed = loadTitleSeed();
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "title_seed_rules.json"), "utf8"));
  const seedDoc = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
  const pinsByCrop = Object.fromEntries((seedDoc.pins || []).map((p) => [p.crop_filename, p]));

  const res = await fetch(DB);
  if (!res.ok) throw new Error(`Firebase GET ${res.status}`);
  const remote = (await res.json()) || {};

  const changes = [];
  for (const [fbKey, prev] of Object.entries(remote)) {
    if (!prev) continue;
    const pin = pinsByCrop[prev.crop_filename];
    if (!pin) continue;

    let label = { ...prev, pin_key: pin.pin_key, ebay_title: pin.ebay_title };
    const before = prev.cleaned_title || "";

    if (prev.accepted) {
      label.cleaned_title = TitleSeed.sanitizeCleanedTitle(before, rules);
      label.rules_version = RULES_VERSION;
      label.updated_at = new Date().toISOString();
    } else {
      const fresh = makeSeedLabel(pin, TitleSeed, rules);
      label.tokens = fresh.tokens;
      label.include_order = fresh.order;
      label.cleaned_title = fresh.cleaned;
      label.rules_version = RULES_VERSION;
      label.updated_at = new Date().toISOString();
    }

    remote[fbKey] = labelPayload(label);
    if (before !== label.cleaned_title || prev.rules_version !== RULES_VERSION) {
      changes.push({ crop: prev.crop_filename, before, after: label.cleaned_title });
    }
  }

  console.log(`Resanitized ${Object.keys(remote).length} labels, changed ${changes.length}`);
  for (const c of changes) {
    console.log(`  ${c.crop}`);
    console.log(`    was: ${c.before}`);
    console.log(`    now: ${c.after}`);
  }

  if (DRY) {
    console.log("\n(dry run — no Firebase write)");
    return;
  }

  const put = await fetch(DB, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(remote),
  });
  if (!put.ok) throw new Error(`Firebase PUT ${put.status} ${await put.text()}`);
  console.log("\nFirebase updated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
