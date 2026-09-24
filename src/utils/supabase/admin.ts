import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client (SUPABASE_SECRET_KEY, legacy SUPABASE_SERVICE_ROLE_KEY).
 * Bypasses RLS. Server-only: used where the client must not forge data (e.g.
 * messages.hint_color) and for rate-limit bookkeeping in send_rate.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL or secret key (SUPABASE_SECRET_KEY, see .env.example)",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
