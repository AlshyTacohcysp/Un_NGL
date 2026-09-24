import { createBrowserClient } from "@supabase/ssr";

export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // New publishable key (sb_publishable_…) or legacy anon key (eyJ…). The
  // NEXT_PUBLIC_ prefix is mandatory: without it the browser bundle has no key
  // and signInWithOAuth throws "URL and API key are required".
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)",
    );
  }
  return createBrowserClient(url, key);
};
