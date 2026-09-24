import sharp from "sharp";
import { Vibrant } from "node-vibrant/node";

/**
 * Photo -> colour palette pipeline.
 *
 * 1. `sharp` decodes (and rejects anything it cannot decode).
 * 2. `node-vibrant` extracts candidate swatches from the decoded pixels.
 * 3. An OKLab filter keeps visible, distinguishable colours (drops near-greys,
 *    near-blacks and near-whites).
 * 4. At most 6 colours, most representative first.
 */

export const PALETTE_MAX = 6;

const MAX_DECODE_DIMENSION = 320;

export const ALLOWED_IMAGE_FORMATS = ["jpeg", "png", "webp", "gif"] as const;
export type AllowedImageFormat = (typeof ALLOWED_IMAGE_FORMATS)[number];

export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

/** Format detected by sharp (content sniffing, not the declared MIME type). */
export async function detectImageFormat(bytes: Buffer): Promise<AllowedImageFormat> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    throw new UnsupportedImageError("Image could not be decoded");
  }
  const format = meta.format as AllowedImageFormat | undefined;
  if (!format || !(ALLOWED_IMAGE_FORMATS as readonly string[]).includes(format)) {
    throw new UnsupportedImageError(
      `Unsupported image format (allowed: ${ALLOWED_IMAGE_FORMATS.join(", ")})`,
    );
  }
  return format;
}

/**
 * Minimal `@vibrant/image` implementation whose decoder is sharp: sharp does
 * the decoding, node-vibrant only sees pixels. (node-vibrant's own NodeImage
 * decodes with jimp — we replace it via `useImageClass`.)
 */
class SharpDecodedImage {
  private image: { data: Uint8ClampedArray; width: number; height: number } | null =
    null;

  async load(src: Buffer): Promise<SharpDecodedImage> {
    const { data, info } = await sharp(src, { failOn: "error" })
      .rotate()
      .resize(MAX_DECODE_DIMENSION, MAX_DECODE_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    this.image = {
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    };
    return this;
  }

  clear(): void {
    this.image = null;
  }

  update(imageData: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }): void {
    this.image = imageData;
  }

  private get() {
    if (!this.image) throw new Error("Image not loaded");
    return this.image;
  }

  getWidth(): number {
    return this.get().width;
  }

  getHeight(): number {
    return this.get().height;
  }

  getPixelCount(): number {
    return this.get().width * this.get().height;
  }

  getImageData() {
    return this.get();
  }

  resize(targetWidth: number, targetHeight: number, _ratio: number): void {
    const src = this.get();
    const w = Math.max(1, Math.round(targetWidth));
    const h = Math.max(1, Math.round(targetHeight));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
        const s = (sy * src.width + sx) * 4;
        const d = (y * w + x) * 4;
        out[d] = src.data[s];
        out[d + 1] = src.data[s + 1];
        out[d + 2] = src.data[s + 2];
        out[d + 3] = src.data[s + 3];
      }
    }
    this.image = { data: out, width: w, height: h };
  }

  scaleDown(opts: { maxDimension: number; quality: number }): void {
    const width = this.getWidth();
    const height = this.getHeight();
    let ratio = 1;
    if (opts.maxDimension > 0) {
      const maxSide = Math.max(width, height);
      if (maxSide > opts.maxDimension) ratio = opts.maxDimension / maxSide;
    } else {
      ratio = 1 / opts.quality;
    }
    if (ratio < 1) this.resize(width * ratio, height * ratio, ratio);
  }

  remove(): void {
    this.clear();
  }
}

// --- OKLab -----------------------------------------------------------------

interface Oklab {
  L: number;
  a: number;
  b: number;
}

function hexToOklab(hex: string): Oklab {
  const n = parseInt(hex.replace(/^#/, ""), 16);
  const srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const lin = srgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabDistance(x: Oklab, y: Oklab): number {
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

// Visible on white cards, distinguishable from each other.
const MIN_LIGHTNESS = 0.3;
const MAX_LIGHTNESS = 0.88;
const MIN_CHROMA = 0.045;
const MIN_DISTANCE = 0.055;

function isPresentable(c: Oklab): boolean {
  const chroma = Math.hypot(c.a, c.b);
  return (
    c.L >= MIN_LIGHTNESS && c.L <= MAX_LIGHTNESS && chroma >= MIN_CHROMA
  );
}

interface Candidate {
  hex: string;
  population: number;
  lab: Oklab;
}

function filterOklab(candidates: Candidate[]): string[] {
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    if (!isPresentable(candidate.lab)) continue;
    if (kept.some((k) => oklabDistance(k.lab, candidate.lab) < MIN_DISTANCE)) {
      continue;
    }
    kept.push(candidate);
    if (kept.length >= PALETTE_MAX) break;
  }
  return kept.map((k) => k.hex);
}

/**
 * Extract up to 6 palette colours from an uploaded photo.
 * Returns lowercase `#rrggbb` strings, most representative first.
 */
export async function extractPalette(bytes: Buffer): Promise<string[]> {
  await detectImageFormat(bytes);

  const palette = await Vibrant.from(bytes)
    .useImageClass(SharpDecodedImage as never)
    .maxDimension(160)
    .getPalette();

  const candidates: Candidate[] = Object.values(palette)
    .filter((swatch): swatch is NonNullable<typeof swatch> => swatch != null)
    .map((swatch) => ({
      hex: swatch.hex.toLowerCase(),
      population: swatch.population,
      lab: hexToOklab(swatch.hex),
    }))
    .sort((x, y) => y.population - x.population);

  const presentable = filterOklab(candidates);
  if (presentable.length > 0) return presentable;

  // Greyscale (or fully filtered) photo: fall back to the raw candidates so a
  // photo still yields a palette instead of nothing.
  const seen: Oklab[] = [];
  const fallback: string[] = [];
  for (const candidate of candidates) {
    if (seen.some((k) => oklabDistance(k, candidate.lab) < MIN_DISTANCE)) continue;
    seen.push(candidate.lab);
    fallback.push(candidate.hex);
    if (fallback.length >= PALETTE_MAX) break;
  }
  return fallback;
}
