import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { extractPalette } from "@/lib/palette";
import {
  InvalidUploadError,
  readImageFormFile,
} from "@/lib/image-upload";

/**
 * POST /api/profile/avatar — the ONLY route allowed to change the avatar and
 * the palette. JPEG, PNG, WebP, GIF — 2 MB max. Uploaded to the `nocap`
 * storage bucket (name is historical — do not rename it). The palette is
 * extracted here (sharp decode + node-vibrant + OKLab filter, max 6 colours)
 * and saved on the profile. Past messages keep their hint_color.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized request" },
        { status: 401 },
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

    const { bytes, format, contentType } = await readImageFormFile(
      formData,
      "file",
    );
    const palette = await extractPalette(bytes);

    const admin = createAdminClient();
    const bucket = "nocap"; // historical bucket name — do not rename
    const ext = format === "jpeg" ? "jpg" : format;
    const path = `avatars/${user.id}-${Date.now()}.${ext}`;

    // Best-effort cleanup of the previous avatar file.
    const { data: current } = await admin
      .from("profiles")
      .select("avatar")
      .eq("id", user.id)
      .maybeSingle();
    const oldUrl = current?.avatar as string | null | undefined;
    if (oldUrl) {
      const marker = `/object/public/${bucket}/`;
      const at = oldUrl.indexOf(marker);
      if (at !== -1) {
        const oldPath = decodeURIComponent(oldUrl.slice(at + marker.length));
        if (oldPath.startsWith("avatars/")) {
          await admin.storage.from(bucket).remove([oldPath]);
        }
      }
    }

    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });
    if (uploadError) {
      console.error("Avatar upload failed:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload avatar" },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(bucket).getPublicUrl(path);

    const { error: updateError } = await admin
      .from("profiles")
      .update({ avatar: publicUrl, palette })
      .eq("id", user.id);
    if (updateError) {
      console.error("Profile avatar update failed:", updateError);
      return NextResponse.json(
        { error: "Failed to update user profile" },
        { status: 500 },
      );
    }

    return NextResponse.json({ avatar: publicUrl, palette });
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
