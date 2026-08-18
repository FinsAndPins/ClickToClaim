import type { Bindings } from "./types";

export type ModerationResult =
  | { ok: true; provider: string }
  | { ok: false; provider: string; codes: string[] };

const STRICT_GOOGLE_FAIL = new Set(["LIKELY", "VERY_LIKELY", "POSSIBLE"]);

export function hasModerationProvider(env: Bindings): boolean {
  return Boolean(
    (env.SIGHTENGINE_USER && env.SIGHTENGINE_SECRET) || env.GOOGLE_VISION_API_KEY
  );
}

export async function moderateImage(
  env: Bindings,
  bytes: ArrayBuffer,
  contentType: string
): Promise<ModerationResult> {
  if (env.SIGHTENGINE_USER && env.SIGHTENGINE_SECRET) {
    return moderateSightengine(env, bytes, contentType);
  }
  if (env.GOOGLE_VISION_API_KEY) {
    return moderateGoogle(env, bytes);
  }
  if (env.ENVIRONMENT === "development") {
    // Local UI work only. Production must have a provider (fail closed).
    return { ok: true, provider: "dev_pass" };
  }
  return {
    ok: false,
    provider: "none",
    codes: ["moderation_not_configured"],
  };
}

async function moderateSightengine(
  env: Bindings,
  bytes: ArrayBuffer,
  contentType: string
): Promise<ModerationResult> {
  const form = new FormData();
  form.set("models", "nudity-2.1,wad,offensive,gore-2.0");
  form.set("api_user", env.SIGHTENGINE_USER!);
  form.set("api_secret", env.SIGHTENGINE_SECRET!);
  const ext = contentType.includes("png") ? "png" : "jpg";
  form.set("media", new Blob([bytes], { type: contentType || "image/jpeg" }), `upload.${ext}`);

  const res = await fetch("https://api.sightengine.com/1.0/check.json", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    return { ok: false, provider: "sightengine", codes: [`http_${res.status}`] };
  }
  const data = (await res.json()) as Record<string, unknown>;
  const codes = sightengineCodes(data);
  if (codes.length) return { ok: false, provider: "sightengine", codes };
  return { ok: true, provider: "sightengine" };
}

function sightengineCodes(data: Record<string, unknown>): string[] {
  const codes: string[] = [];
  const threshold = 0.15; // "even slightly questionable"
  const nudity = data.nudity as Record<string, number> | undefined;
  if (nudity) {
    if ((nudity.sexual_activity ?? 0) > threshold) codes.push("nudity.sexual_activity");
    if ((nudity.sexual_display ?? 0) > threshold) codes.push("nudity.sexual_display");
    if ((nudity.erotica ?? 0) > threshold) codes.push("nudity.erotica");
    if ((nudity.very_suggestive ?? 0) > threshold) codes.push("nudity.very_suggestive");
    if ((nudity.suggestive ?? 0) > 0.35) codes.push("nudity.suggestive");
  }
  const wad = data.weapon as number | undefined;
  if (typeof wad === "number" && wad > threshold) codes.push("weapon");
  const alcohol = data.alcohol as number | undefined;
  if (typeof alcohol === "number" && alcohol > 0.5) codes.push("alcohol");
  const drugs = data.drugs as number | undefined;
  if (typeof drugs === "number" && drugs > threshold) codes.push("drugs");
  const offensive = data.offensive as Record<string, number> | undefined;
  if (offensive) {
    for (const [k, v] of Object.entries(offensive)) {
      if (typeof v === "number" && v > threshold && k !== "prob") codes.push(`offensive.${k}`);
    }
  }
  const gore = data.gore as Record<string, number> | undefined;
  if (gore && (gore.prob ?? 0) > threshold) codes.push("gore");
  return codes;
}

async function moderateGoogle(env: Bindings, bytes: ArrayBuffer): Promise<ModerationResult> {
  const b64 = arrayBufferToBase64(bytes);
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(env.GOOGLE_VISION_API_KEY!)}`,
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
    return { ok: false, provider: "google_vision", codes: [`http_${res.status}`] };
  }
  const data = (await res.json()) as {
    responses?: Array<{
      safeSearchAnnotation?: Record<string, string>;
    }>;
  };
  const ann = data.responses?.[0]?.safeSearchAnnotation ?? {};
  const codes: string[] = [];
  for (const [k, v] of Object.entries(ann)) {
    if (STRICT_GOOGLE_FAIL.has(v)) codes.push(`safesearch.${k}.${v}`);
  }
  if (codes.length) return { ok: false, provider: "google_vision", codes };
  return { ok: true, provider: "google_vision" };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
