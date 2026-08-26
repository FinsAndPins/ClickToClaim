/**
 * Undo Lexi movie-title edits; strip Chaser + LE numbers; bump to v7_no_chaser_le_num.
 * Usage: node migrate_firebase_labels.mjs [--dry-run]
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
const EXPORT_PATH = path.join(__dirname, "training_exports/accepted_labels_latest.json");

/** Revert Lexi session — restore PinDad/export baseline before migrate. */
const LEXI_REVERT_CROPS = new Set([
  "img1_pin01.jpg",
  "img1_pin02.jpg",
  "img1_pin03.jpg",
  "img1_pin05.jpg",
  "img1_pin06.jpg",
  "img1_pin07.jpg",
  "img1_pin10.jpg",
  "img1_pin25.jpg",
]);

const EDITION_NUMBERS = new Set(["100", "200", "250", "300", "400", "500", "600", "2023", "2026"]);

function loadTitleSeed() {
  const code = fs.readFileSync(path.join(__dirname, "title_seed.js"), "utf8");
  vm.runInThisContext(code, { filename: "title_seed.js" });
  return globalThis.TitleSeed;
}

function migrateCleanedTitleString(ct, TitleSeed, rules) {
  const { normalizeKey } = TitleSeed;
  const words = String(ct || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  let seenLe = false;
  for (const w of words) {
    const k = normalizeKey(w);
    if (k === "chaser") continue;
    if (EDITION_NUMBERS.has(k)) continue;
    if (k === "le" || /^le\d+$/i.test(w.replace(/\s/g, ""))) {
      if (!seenLe) {
        out.push(rules.le_in_title || "LE");
        seenLe = true;
      }
      continue;
    }
    if (k === "adorbs" || k === "adorb") {
      out.push(rules.adorbs_canonical || "Adorbs");
      continue;
    }
    let text = w.replace(/[!?,.;:()\"“”‘’]/g, "");
    if (/^adorbs!?$/i.test(text)) text = rules.adorbs_canonical || "Adorbs";
    if (/^adorb$/i.test(text)) text = rules.adorbs_canonical || "Adorbs";
    out.push(text);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
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

function syncTokensFromCleaned(label, TitleSeed) {
  const { normalizeKey } = TitleSeed;
  const cleanedKeys = new Set(
    label.cleaned_title.split(/\s+/).map(normalizeKey).filter(Boolean)
  );
  label.include_order = [];
  for (const t of label.tokens) {
    if (t.state === "never" && t.desc_only) continue;
    if (cleanedKeys.has(t.key)) {
      t.state = "on";
      label.include_order.push(t.id);
    } else if (t.state === "on") {
      t.state = "off";
    }
  }
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
    rules_version: label.rules_version || RULES_VERSION,
  };
}

function buildLabel(pin, prev, TitleSeed, rules, exportByCrop) {
  const crop = pin.crop_filename;
  const wasAccepted = !!(prev.accepted || prev.accepted_at);
  const exportRow = exportByCrop[crop];
  const restoreAccept = wasAccepted || (LEXI_REVERT_CROPS.has(crop) && exportRow?.accepted_at);

  let sourceTitle = prev.cleaned_title || "";
  if (LEXI_REVERT_CROPS.has(crop) && exportByCrop[crop]) {
    sourceTitle = exportByCrop[crop].cleaned_title;
  }

  const label = makeSeedLabel(pin, TitleSeed, rules);
  label.cleaned_title = migrateCleanedTitleString(sourceTitle, TitleSeed, rules);
  if (!label.cleaned_title) {
    label.cleaned_title = migrateCleanedTitleString(
      makeSeedLabel(pin, TitleSeed, rules).cleaned_title,
      TitleSeed,
      rules
    );
  }
  syncTokensFromCleaned(label, TitleSeed);

  if (restoreAccept) {
    label.accepted = true;
    label.reviewed_by = prev.reviewed_by || exportRow?.reviewed_by || "PinDad";
    label.accepted_at = prev.accepted_at || exportRow?.accepted_at || prev.updated_at;
  }

  label.rules_version = RULES_VERSION;
  label.updated_at = new Date().toISOString();
  return label;
}

async function main() {
  const TitleSeed = loadTitleSeed();
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "title_seed_rules.json"), "utf8"));
  const seedDoc = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
  const exportDoc = JSON.parse(fs.readFileSync(EXPORT_PATH, "utf8"));
  const exportByCrop = Object.fromEntries((exportDoc.pins || []).map((p) => [p.crop_filename, p]));
  const pinsByCrop = Object.fromEntries((seedDoc.pins || []).map((p) => [p.crop_filename, p]));
  const pinsByKey = Object.fromEntries((seedDoc.pins || []).map((p) => [p.pin_key, p]));

  const res = await fetch(DB);
  if (!res.ok) throw new Error(`Firebase GET ${res.status}`);
  const remote = (await res.json()) || {};

  const out = {};
  const changes = [];

  for (const [fbKey, prev] of Object.entries(remote)) {
    if (!prev) continue;
    const crop = prev.crop_filename;
    const pin = pinsByCrop[crop] || pinsByKey[prev.pin_key];
    if (!pin) {
      out[fbKey] = prev;
      continue;
    }

    const label = buildLabel(pin, prev, TitleSeed, rules, exportByCrop);
    const payload = labelPayload(label);
    out[fbKey] = payload;

    if (
      payload.cleaned_title !== (prev.cleaned_title || "") ||
      payload.accepted !== !!prev.accepted ||
      payload.rules_version !== (prev.rules_version || "")
    ) {
      changes.push({
        crop,
        before: prev.cleaned_title,
        after: payload.cleaned_title,
        accepted: [!!prev.accepted, payload.accepted],
      });
    }
  }

  console.log(`Labels: ${Object.keys(out).length}, changed: ${changes.length}`);
  for (const c of changes) {
    console.log(`\n${c.crop} accepted ${c.accepted[0]}→${c.accepted[1]}`);
    console.log(`  was: ${c.before}`);
    console.log(`  now: ${c.after}`);
  }

  if (DRY) {
    console.log("\n(dry run — no Firebase write)");
    return;
  }

  const put = await fetch(DB, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(out),
  });
  if (!put.ok) throw new Error(`Firebase PUT ${put.status} ${await put.text()}`);
  console.log("\nFirebase updated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
