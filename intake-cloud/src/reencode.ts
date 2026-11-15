/**
 * Decode uploaded image bytes and write a fresh JPEG we control.
 * Applies JPEG EXIF Orientation (same idea as Mac watcher ImageOps.exif_transpose)
 * then strips EXIF so pixels are upright for browsers + Cloud Run.
 * HEIC is not decoded here (Workers). Callers should convert in-browser before upload,
 * or fall back to Cloud Run `/convert-to-jpeg` (Mac production intake still uses sips).
 */

export type ReencodeResult =
  | { ok: true; bytes: Uint8Array; contentType: "image/jpeg"; filename: string }
  | { ok: false; reason: string };

type Rgba = { data: Uint8Array; width: number; height: number };

function baseName(name: string | null | undefined): string {
  const raw = (name || "photo").trim() || "photo";
  const noPath = raw.replace(/^.*[\\/]/, "");
  const stem = noPath.replace(/\.[^.]+$/, "") || "photo";
  return stem.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "photo";
}

export function looksHeic(contentType: string, filename: string | null | undefined): boolean {
  const t = (contentType || "").toLowerCase();
  const n = (filename || "").toLowerCase();
  return t.includes("heic") || t.includes("heif") || /\.heic$|\.heif$/.test(n);
}

/** JPEG filename when promoting a converted HEIC. */
export function jpegNameFromOriginal(originalFilename: string | null | undefined): string {
  return `${baseName(originalFilename)}.jpg`;
}

/** Read JPEG EXIF Orientation (1–8). Returns 1 if missing/unreadable. */
export function jpegExifOrientation(buf: Uint8Array): number {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    const size = (buf[offset + 2] << 8) | buf[offset + 3];
    if (size < 2) break;
    if (marker === 0xe1 && offset + 4 + size <= buf.length + 2) {
      const start = offset + 4;
      // "Exif\0\0"
      if (
        buf[start] === 0x45 &&
        buf[start + 1] === 0x78 &&
        buf[start + 2] === 0x69 &&
        buf[start + 3] === 0x66 &&
        buf[start + 4] === 0 &&
        buf[start + 5] === 0
      ) {
        const tiff = start + 6;
        if (tiff + 8 > buf.length) return 1;
        const le = buf[tiff] === 0x49 && buf[tiff + 1] === 0x49;
        const be = buf[tiff] === 0x4d && buf[tiff + 1] === 0x4d;
        if (!le && !be) return 1;
        const u16 = (i: number) => (le ? buf[i] | (buf[i + 1] << 8) : (buf[i] << 8) | buf[i + 1]);
        const u32 = (i: number) =>
          le
            ? buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)
            : (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3];
        const ifd0 = tiff + u32(tiff + 4);
        if (ifd0 + 2 > buf.length) return 1;
        const entries = u16(ifd0);
        for (let e = 0; e < entries; e++) {
          const ent = ifd0 + 2 + e * 12;
          if (ent + 12 > buf.length) break;
          const tag = u16(ent);
          if (tag === 0x0112) {
            const v = u16(ent + 8);
            if (v >= 1 && v <= 8) return v;
            return 1;
          }
        }
      }
    }
    if (marker === 0xda) break; // SOS
    offset += 2 + size;
  }
  return 1;
}

function rotate90CW(src: Rgba): Rgba {
  const { data, width: w, height: h } = src;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const dx = h - 1 - y;
      const dy = x;
      const di = (dy * h + dx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: h, height: w };
}

function flipH(src: Rgba): Rgba {
  const { data, width: w, height: h } = src;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (y * w + (w - 1 - x)) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

function flipV(src: Rgba): Rgba {
  const { data, width: w, height: h } = src;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = ((h - 1 - y) * w + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

/** Bake EXIF Orientation into pixels (matches Pillow ImageOps.exif_transpose). */
export function applyExifOrientation(rgba: Rgba, orientation: number): Rgba {
  const o = orientation || 1;
  if (o === 1) return rgba;
  if (o === 2) return flipH(rgba);
  if (o === 3) return flipV(flipH(rgba));
  if (o === 4) return flipV(rgba);
  if (o === 5) return rotate90CW(flipH(rgba)); // transpose
  if (o === 6) return rotate90CW(rgba); // 90 CW
  if (o === 7) return flipH(rotate90CW(rgba)); // transverse
  if (o === 8) return rotate90CW(rotate90CW(rotate90CW(rgba))); // 90 CCW
  return rgba;
}

async function decodeToRgba(
  buf: Uint8Array,
  contentType: string,
  originalFilename: string | null | undefined
): Promise<Rgba> {
  const type = (contentType || "image/jpeg").toLowerCase();
  if (type.includes("png") || (originalFilename || "").toLowerCase().endsWith(".png")) {
    const decode = (await import("@jsquash/png/decode")).default;
    return decode(buf);
  }
  if (type.includes("webp") || (originalFilename || "").toLowerCase().endsWith(".webp")) {
    const decode = (await import("@jsquash/webp/decode")).default;
    return decode(buf);
  }
  const decode = (await import("@jsquash/jpeg/decode")).default;
  const rgba = await decode(buf);
  const orient = jpegExifOrientation(buf);
  return applyExifOrientation(rgba, orient);
}

function nearestResize(rgba: Rgba, maxEdge: number): Rgba {
  const long = Math.max(rgba.width, rgba.height);
  if (long <= maxEdge) return rgba;
  const scale = maxEdge / long;
  const tw = Math.max(1, Math.round(rgba.width * scale));
  const th = Math.max(1, Math.round(rgba.height * scale));
  const out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(rgba.height - 1, Math.floor(y / scale));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(rgba.width - 1, Math.floor(x / scale));
      const si = (sy * rgba.width + sx) * 4;
      const di = (y * tw + x) * 4;
      out[di] = rgba.data[si];
      out[di + 1] = rgba.data[si + 1];
      out[di + 2] = rgba.data[si + 2];
      out[di + 3] = rgba.data[si + 3];
    }
  }
  return { data: out, width: tw, height: th };
}

export async function reencodeToJpeg(
  input: ArrayBuffer,
  contentType: string,
  originalFilename: string | null | undefined
): Promise<ReencodeResult> {
  if (looksHeic(contentType, originalFilename)) {
    return { ok: false, reason: "heic_unsupported_on_worker" };
  }

  let rgba: Rgba;
  try {
    rgba = await decodeToRgba(new Uint8Array(input), contentType, originalFilename);
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

/**
 * Downscale for Cloud Run multipart bodies (~32MB request cap).
 * Applies EXIF orientation first (watcher parity).
 */
export async function downscaleJpegForCloudRun(
  input: ArrayBuffer,
  contentType: string,
  originalFilename: string | null | undefined,
  maxEdge = 1800,
  quality = 82
): Promise<ReencodeResult> {
  if (looksHeic(contentType, originalFilename)) {
    return { ok: false, reason: "heic_unsupported_on_worker" };
  }
  let rgba: Rgba;
  try {
    rgba = await decodeToRgba(new Uint8Array(input), contentType, originalFilename);
  } catch (e) {
    return { ok: false, reason: `decode_failed:${String(e).slice(0, 120)}` };
  }

  rgba = nearestResize(rgba, maxEdge);

  try {
    const encode = (await import("@jsquash/jpeg/encode")).default;
    const jpeg = await encode(rgba, { quality });
    return {
      ok: true,
      bytes: new Uint8Array(jpeg),
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
