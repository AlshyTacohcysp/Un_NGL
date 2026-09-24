import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  DEMO_PALETTE_COOKIE,
  DEMO_RECIPIENT,
  decodePaletteCookie,
  ensureSenderToken,
  pickHintColor,
  requireHintSecret,
  tokenFingerprint,
} from "@/lib/color-hint";

/**
 * POST /api/demo/messages — one demo message, coloured exactly like a real
 * send (HMAC-SHA256(HINT_SECRET, destinataire + token) modulo palette) but
 * never stored. Two messages sent from the same demo token share a pastille.
 */

const bodySchema = z.object({
  content: z
    .string()
    .trim()
    .min(5, "Message too short")
    .max(200, "Message too long"),
});

export async function POST(req: NextRequest) {
  try {
    let secret: string;
    try {
      secret = requireHintSecret();
    } catch (err) {
      console.error(err);
      return NextResponse.json(
        { error: "Server is missing HINT_SECRET" },
        { status: 500 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Message must be 5 to 200 characters" },
        { status: 400 },
      );
    }

    const palette = decodePaletteCookie(
      req.cookies.get(DEMO_PALETTE_COOKIE)?.value,
    );
    if (!palette) {
      return NextResponse.json(
        { error: "Extract a palette from a photo first." },
        { status: 400 },
      );
    }

    const sender = ensureSenderToken(req);
    const hintColor = pickHintColor(
      secret,
      DEMO_RECIPIENT,
      sender.token,
      palette,
    );

    const res = NextResponse.json({
      content: parsed.data.content,
      hint_color: hintColor,
      token_fingerprint: tokenFingerprint(secret, sender.token),
    });
    sender.set(res);
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
