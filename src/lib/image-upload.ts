import { Buffer } from "node:buffer";
import {
  ALLOWED_IMAGE_FORMATS,
  detectImageFormat,
  UnsupportedImageError,
  type AllowedImageFormat,
} from "@/lib/palette";

/** JPEG, PNG, WebP, GIF — 2 MB max (mirrors the storage bucket limits). */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const CONTENT_TYPE_BY_FORMAT: Record<AllowedImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export class InvalidUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUploadError";
  }
}

export async function readImageFormFile(
  formData: FormData,
  field = "file",
): Promise<{ bytes: Buffer; format: AllowedImageFormat; contentType: string }> {
  const file = formData.get(field) ?? formData.get("avatar");
  if (!(file instanceof File)) {
    throw new InvalidUploadError(`Missing file field "${field}"`);
  }
  if (file.size === 0) {
    throw new InvalidUploadError("Empty file");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new InvalidUploadError("Image must be 2MB or less");
  }
  if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type)) {
    throw new InvalidUploadError(
      `Unsupported image type (allowed: ${ALLOWED_IMAGE_FORMATS.join(", ")})`,
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  let format: AllowedImageFormat;
  try {
    // Content sniffing with sharp — the declared MIME type is not trusted.
    format = await detectImageFormat(bytes);
  } catch (err) {
    if (err instanceof UnsupportedImageError) {
      throw new InvalidUploadError(err.message);
    }
    throw err;
  }
  return { bytes, format, contentType: CONTENT_TYPE_BY_FORMAT[format] };
}
