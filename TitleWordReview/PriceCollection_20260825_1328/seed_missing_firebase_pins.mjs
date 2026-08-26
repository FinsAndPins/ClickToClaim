/**
 * Push v7 seed labels for pins missing from Firebase (open todos).
 * Usage: node seed_missing_firebase_pins.mjs [--dry-run]
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
  return {
    pin_key: pin.pin_key,
    crop_filename: pin.crop_filename,
    ebay_title: pin.ebay_title,
    tokens,
    include_order: order,
    cleaned_title: cleaned,
    accepted: false,
    reviewed_by: "",
    updated_at: new Date().toISOString(),
    accepted_at: null,
    rules_version: RULES_VERSION,
  };
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
    accepted: false,
    reviewed_by: "",
    updated_at: label.updated_at,
    accepted_at: null,
    batch_id: BATCH_ID,
    collection: COLLECTION,
    rules_version: RULES_VERSION,
  };
}

async function main() {
  const TitleSeed = loadTitleSeed();
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "title_seed_rules.json"), "utf8"));
  const seedDoc = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
  const res = await fetch(DB);
  if (!res.ok) throw new Error(`Firebase GET ${res.status}`);
  const remote = (await res.json()) || {};
  const fbCrops = new Set(Object.values(remote).map((v) => v?.crop_filename).filter(Boolean));

  const added = [];
  for (const pin of seedDoc.pins || []) {
    if (fbCrops.has(pin.crop_filename)) continue;
    const label = makeSeedLabel(pin, TitleSeed, rules);
    const key = safePk(pin.pin_key);
    remote[key] = labelPayload(label);
    added.push({ crop: pin.crop_filename, cleaned: label.cleaned_title });
  }

  console.log(`Adding ${added.length} missing pins:`);
  for (const row of added) {
    console.log(`  ${row.crop}: ${row.cleaned}`);
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
