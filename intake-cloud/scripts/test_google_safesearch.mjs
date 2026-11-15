#!/usr/bin/env node
/**
 * Mac helper: run Google Vision SafeSearch on a folder of board photos
 * BEFORE we point real sellers at production.
 *
 *   export GOOGLE_VISION_API_KEY='...'
 *   node scripts/test_google_safesearch.mjs /path/to/board/jpgs
 *
 * Does not upload anything to Fins & Pins storage. Prints pass/fail + labels.
 * Fail rules match the Worker (pin-board tuned):
 *   racy → VERY_LIKELY only
 *   adult / violence / medical → LIKELY or VERY_LIKELY
 *   spoof → never reject
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

function categoryFails(category, value) {
  const v = String(value).toUpperCase();
  if (category === "spoof") return false;
  if (category === "racy") return v === "VERY_LIKELY";
  if (category === "adult" || category === "violence" || category === "medical") {
    return v === "LIKELY" || v === "VERY_LIKELY";
  }
  return v === "LIKELY" || v === "VERY_LIKELY";
}

const key = process.env.GOOGLE_VISION_API_KEY;
const dir = process.argv[2];

if (!key || !dir) {
  console.error("Usage: GOOGLE_VISION_API_KEY=... node scripts/test_google_safesearch.mjs DIR");
  process.exit(1);
}

const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
if (!files.length) {
  console.error("No jpeg/png/webp files in", dir);
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  const bytes = await readFile(path.join(dir, name));
  const b64 = bytes.toString("base64");
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: b64 },
            features: [{ type: "SAFE_SEARCH_DETECTION" }],
          },
        ],
      }),
    }
  );
  if (!res.ok) {
    console.log("ERROR", name, res.status, await res.text());
    failed++;
    continue;
  }
  const data = await res.json();
  const ann = data.responses?.[0]?.safeSearchAnnotation ?? {};
  const codes = Object.entries(ann)
    .filter(([k, v]) => categoryFails(k, v))
    .map(([k, v]) => `${k}.${v}`);
  if (codes.length) {
    failed++;
    console.log("FAIL", name, codes.join(", "));
  } else {
    console.log("PASS", name, JSON.stringify(ann));
  }
}
console.log(`\n${files.length - failed} pass / ${failed} fail / ${files.length} total`);
process.exit(failed ? 2 : 0);
