import { NextRequest, NextResponse } from "next/server";
import { extractPalette } from "@/lib/palette";
import { InvalidUploadError, readImageFormFile } from "@/lib/image-upload";
import {
  DEMO_PALETTE_COOKIE,
  encodePaletteCookie,
  ensureSenderToken,
  requireHintSecret,
  tokenFingerprint,
} from "@/lib/color-hint";

/**
 * POST /api/demo/extract — the account-free lab: same pipeline as the real
 * avatar route (sharp decode, node-vibrant extract, OKLab filter, max 6
 * colours) but nothing is stored server-side. The palette goes in a short-lived
 * httpOnly demo cookie so POST /api/demo/messages can compute demo colours.
 */

// Tiny in-memory throttle: this route decodes unauthenticated uploads.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (throttled(ip)) {
      return NextResponse.json(
        { error: "Too many demo requests — try again in a minute." },
        { status: 429 },
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart form data" },
        { status: 400 },
      );
    }

    const { bytes } = await readImageFormFile(formData, "file");
    const palette = await extractPalette(bytes);

    let fingerprint = "";
    try {
      const secret = requireHintSecret();
      const sender = ensureSenderToken(req);
      const res = NextResponse.json({
        palette,
        token_fingerprint: tokenFingerprint(secret, sender.token),
      });
      sender.set(res);
      res.cookies.set(DEMO_PALETTE_COOKIE, encodePaletteCookie(palette), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60,
      });
      return res;
    } catch {
      // HINT_SECRET missing: still show the palette, without token info.
      return NextResponse.json({ palette, token_fingerprint: fingerprint });
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
