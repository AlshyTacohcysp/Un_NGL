import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Only username and bio are updatable here. The body `id` is IGNORED on
// purpose (the authenticated user is the target). Avatar and palette never
// pass through this route — only POST /api/profile/avatar may set them.
const updateBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message:
        "Username can only contain letters, numbers, underscores, and hyphens.",
    }),
  bio: z.string().trim().max(100).optional().nullable(),
});

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized request" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }
  const { username, bio } = parsed.data;

  const { data: existing, error: checkError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .neq("id", user.id)
    .maybeSingle();

  if (checkError) {
    return NextResponse.json(
      { error: "Failed to check username" },
      { status: 500 },
    );
  }
  if (existing) {
    return NextResponse.json(
      { error: "Username is already taken" },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ username, bio: bio ?? null })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update user profile" },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}
