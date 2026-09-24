import { createHmac, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Colour-hint mechanics.
 *
 * The colour is a HINT, never an identity:
 * - same browser (same nc_sender cookie) -> often the same colour,
 * - several strangers share one colour (it's a modulo over at most 6),
 * - it is not a name and not a proof. Never claim "we know who wrote this".
 */

export const SENDER_COOKIE = "nc_sender";
export const DEMO_PALETTE_COOKIE = "nc_demo_palette";
/** Recipient key used by the /demo lab (no real profile involved). */
export const DEMO_RECIPIENT = "demo";

export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_MAX_PER_BROWSER = 8;
export const RATE_MAX_PER_IP = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireHintSecret(): string {
  const secret = process.env.HINT_SECRET;
  if (!secret) {
    throw new Error("HINT_SECRET is not set (see .env.example)");
  }
  return secret;
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Random per-browser token, kept in the httpOnly `nc_sender` cookie. */
export function ensureSenderToken(req: NextRequest): {
  token: string;
  isNew: boolean;
  set: (res: NextResponse) => void;
} {
  const existing = req.cookies.get(SENDER_COOKIE)?.value;
  const token = existing && UUID_RE.test(existing) ? existing : randomUUID();
  const isNew = token !== existing;
  return {
    token,
    isNew,
    set: (res: NextResponse) => {
      if (!isNew) return;
      res.cookies.set(SENDER_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    },
  };
}

/**
 * hint_color = HMAC-SHA256(HINT_SECRET, destinataire + token) modulo palette.
 * No IP in the computation. Snapshotted at send time — changing the recipient
 * photo never recolours history.
 */
export function pickHintColor(
  secret: string,
  recipient: string,
  token: string,
  palette: string[] | null | undefined,
): string | null {
  if (!palette || palette.length === 0) return null;
  const mac = createHmac("sha256", secret)
    .update(`${recipient}${token}`)
    .digest("hex");
  const index = Number(BigInt(`0x${mac}`) % BigInt(palette.length));
  return palette[index];
}

/** Only hashes go into send_rate — never the raw token. */
export function senderTokenHash(secret: string, token: string): string {
  return hmacHex(secret, `tk:${token}`);
}

/** Only hashes go into send_rate — never the raw IP. */
export function ipHash(secret: string, ip: string): string {
  return hmacHex(secret, `ip:${ip}`);
}

/** Short, safe-to-display fingerprint so the lab can show "same token". */
export function tokenFingerprint(secret: string, token: string): string {
  return hmacHex(secret, `fp:${token}`).slice(0, 8);
}

/** Shared IP as seen by the app server (proxy-aware). Hashed before storage. */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() ?? "";
}

// --- demo palette cookie (bare hexes joined by "_", e.g. "aabbcc_ddeeff") ---

export function encodePaletteCookie(palette: string[]): string {
  return palette.map((c) => c.replace(/^#/, "")).join("_");
}

export function decodePaletteCookie(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const parts = raw.split("_").filter(Boolean);
  if (parts.length === 0) return null;
  const palette: string[] = [];
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{6}$/.test(part)) return null;
    palette.push(`#${part.toLowerCase()}`);
  }
  return palette.slice(0, 6);
}
