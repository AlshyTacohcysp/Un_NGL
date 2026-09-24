import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  RATE_MAX_PER_BROWSER,
  RATE_MAX_PER_IP,
  RATE_WINDOW_MS,
  getClientIp,
  ensureSenderToken,
  ipHash,
  pickHintColor,
  requireHintSecret,
  senderTokenHash,
} from "@/lib/color-hint";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized request" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(req.url);
    const since = searchParams.get("since");
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabase
      .from("messages")
      .select(
        "id, profile_id, content, created_at, hint_color, is_sender_authenticated, is_sender_visible",
        { count: "exact" }, // Returns total number of rows exactly
      )
      .eq("profile_id", user.id);

    // If since_timestamp is provided, fetch only newer message
    if (since) {
      query = query
        .gt("created_at", since)
        .order("created_at", { ascending: false });
    } else {
      // Regular pagination for infinite scroll
      query = query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
    }

    const { data: messages, error: messagesError, count } = await query;

    if (messagesError) {
      return NextResponse.json(
        { error: messagesError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ messages, count });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// The client sends ONLY profile_id + content. Everything else (hint_color,
// sender flags) is decided server-side — extra body fields are ignored so a
// client cannot forge them.
const postBodySchema = z.object({
  profile_id: z.string().uuid(),
  content: z
    .string()
    .trim()
    .min(5, "Message too short")
    .max(200, "Message too long"),
});

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = postBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Missing or invalid profile_id or content" },
        { status: 400 },
      );
    }
    const { profile_id, content } = parsed.data;

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

    // Random per-browser token in the httpOnly `nc_sender` cookie. The colour
    // hint derives from it (together with the recipient) — never from the IP.
    const sender = ensureSenderToken(req);
    const respond = (json: unknown, status = 200) => {
      const res = NextResponse.json(json, { status });
      sender.set(res);
      return res;
    };

    // Inserts go through the service role: with the plain client, RLS would
    // need an insert policy and a client could forge hint_color.
    const admin = createAdminClient();

    // Rate limits — only hashes are written to send_rate.
    const tokenHash = senderTokenHash(secret, sender.token);
    const networkHash = ipHash(secret, getClientIp(req));
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const [{ count: byBrowser }, { count: byNetwork }] = await Promise.all([
      admin
        .from("send_rate")
        .select("id", { count: "exact", head: true })
        .eq("token_hash", tokenHash)
        .gte("created_at", since),
      admin
        .from("send_rate")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", networkHash)
        .gte("created_at", since),
    ]);
    if ((byBrowser ?? 0) >= RATE_MAX_PER_BROWSER) {
      return respond(
        {
          error:
            "Too many messages from this browser. Wait a few minutes and try again.",
        },
        429,
      );
    }
    if ((byNetwork ?? 0) >= RATE_MAX_PER_IP) {
      return respond(
        {
          error:
            "Too many messages from this network. Wait a few minutes and try again.",
        },
        429,
      );
    }

    // Check if the profile is accepting messages
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, accepting_messages, palette")
      .eq("id", profile_id)
      .maybeSingle();

    if (profileError) {
      return respond({ error: "Profile not found" }, 404);
    }
    if (!profile) {
      return respond({ error: "Profile not found" }, 404);
    }
    if (!profile.accepting_messages) {
      return respond(
        { error: "This user is not accepting messages right now." },
        403,
      );
    }

    // hint_color = HMAC-SHA256(HINT_SECRET, destinataire + token) modulo the
    // recipient palette, snapshotted at send time. Changing their photo later
    // does NOT recolour past messages. No IP in the computation.
    const hintColor = pickHintColor(
      secret,
      profile_id,
      sender.token,
      profile.palette,
    );

    const { error: rateError } = await admin
      .from("send_rate")
      .insert({ token_hash: tokenHash, ip_hash: networkHash });
    if (rateError) {
      console.error("send_rate insert failed:", rateError);
      return respond({ error: "Internal server error" }, 500);
    }

    const { error } = await admin.from("messages").insert({
      profile_id,
      content,
      hint_color: hintColor,
    });

    if (error) {
      return respond({ error: error.message }, 500);
    }

    return respond({ success: true, hint_color: hintColor });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized request" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(req.url);
    const messageId = searchParams.get("id");
    if (!messageId) {
      return NextResponse.json(
        { error: "Missing message id" },
        { status: 400 },
      );
    }

    // Check ownership
    const { data: message, error: fetchError } = await supabase
      .from("messages")
      .select("id, profile_id")
      .eq("id", messageId)
      .single();

    if (fetchError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (message.profile_id !== user.id) {
      return NextResponse.json(
        { error: "Unauthorized request" },
        { status: 403 },
      );
    }

    const { error: deleteError } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
