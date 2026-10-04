/**
 * Decode uploaded image bytes and write a fresh JPEG we control.
 * Strips odd containers / EXIF baggage. HEIC is not decoded here (Workers);
 * callers should fall back or convert on the Mac with sips.
 */

export type ReencodeResult =
  | { ok: true; bytes: Uint8Array; contentType: "image/jpeg"; filename: string }
  | { ok: false; reason: string };

function baseName(name: string | null | undefined): string {
  const raw = (name || "photo").trim() || "photo";
  const noPath = raw.replace(/^.*[\\/]/, "");
  const stem = noPath.replace(/\.[^.]+$/, "") || "photo";
  return stem.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "photo";
}

function looksHeic(contentType: string, filename: string | null | undefined): boolean {
  const t = (contentType || "").toLowerCase();
  const n = (filename || "").toLowerCase();
  return t.includes("heic") || t.includes("heif") || /\.heic$|\.heif$/.test(n);
}

export async function reencodeToJpeg(
  input: ArrayBuffer,
  contentType: string,
  originalFilename: string | null | undefined
): Promise<ReencodeResult> {
  if (looksHeic(contentType, originalFilename)) {
    return { ok: false, reason: "heic_unsupported_on_worker" };
  }

  const type = (contentType || "image/jpeg").toLowerCase();
  const buf = new Uint8Array(input);
  let rgba: { data: Uint8Array; width: number; height: number };

  try {
    if (type.includes("png") || (originalFilename || "").toLowerCase().endsWith(".png")) {
      const decode = (await import("@jsquash/png/decode")).default;
      rgba = await decode(buf);
    } else if (type.includes("webp") || (originalFilename || "").toLowerCase().endsWith(".webp")) {
      const decode = (await import("@jsquash/webp/decode")).default;
      rgba = await decode(buf);
    } else {
      const decode = (await import("@jsquash/jpeg/decode")).default;
      rgba = await decode(buf);
    }
  } catch (e) {
    return { ok: false, reason: `decode_failed:${String(e).slice(0, 120)}` };
  }

  try {
    const encode = (await import("@jsquash/jpeg/encode")).default;
    const out = await encode(rgba, { quality: 90 });
    return {
      ok: true,
      bytes: new Uint8Array(out),
      contentType: "image/jpeg",
      filename: `${baseName(originalFilename)}.jpg`,
    };
  } catch (e) {
    return { ok: false, reason: `encode_failed:${String(e).slice(0, 120)}` };
  }
}

/** Safe folder name from intake form seller_name. */
export function folderNameFromSeller(sellerName: string, collectionId: string): string {
  const cleaned = sellerName
    .trim()
    .replace(/[^\w\s.-]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
  const base = cleaned || "Seller";
  return `${base}_${collectionId.slice(0, 8)}`;
}
