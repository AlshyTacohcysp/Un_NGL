-- No Cap — initial schema (the upstream repo shipped no SQL; this file is the
-- canonical schema). Run once against the Supabase project (SQL editor or
-- `supabase db push`).
--
-- Honesty note (product rule): messages.hint_color is a COLOUR HINT extracted
-- from the recipient's photo. It is NOT an identity: same browser often gets
-- the same colour, and several strangers share one colour. Never present it as
-- "who wrote this".

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Hex validation for palettes. All hex checks live here (called from CHECK
-- constraints — the CHECK expressions themselves must NOT contain a subquery,
-- Postgres raises 0A000 "cannot use subquery in check constraint").
--
-- Accepts a palette array of 0..6 colours, each formatted #rrggbb (any case).
create or replace function public.palette_hex_ok(palette text[])
returns boolean
language plpgsql
immutable
as $$
declare
  c text;
begin
  if palette is null then
    return true;
  end if;
  if cardinality(palette) > 6 then
    return false;
  end if;
  foreach c in array palette loop
    if c is null or c !~ '^#[0-9a-fA-F]{6}$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

grant execute on function public.palette_hex_ok(text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  email text,
  username text unique,
  bio text,
  avatar text,
  accepting_messages boolean not null default false,
  -- Colour palette extracted from the avatar photo (max 6 colours).
  -- Re-uploading a photo replaces the palette; past messages keep the
  -- hint_color they were sent with.
  palette text[] not null default '{}',
  constraint profiles_palette_hex_ok check (public.palette_hex_ok(palette))
);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 5 and 200),
  -- Colour hint: HMAC-SHA256(HINT_SECRET, recipient || sender-token) modulo
  -- the recipient palette, computed SERVER-SIDE at send time and snapshotted
  -- here. Changing the photo never recolours history. Not an identity.
  hint_color text,
  -- Legacy nocap columns, kept for compatibility (defaults; not sent by the
  -- current client).
  sender_id text,
  is_sender_authenticated boolean not null default false,
  is_sender_visible boolean not null default false,
  constraint messages_hint_color_hex_ok
    check (hint_color is null or public.palette_hex_ok(array[hint_color]))
);

create index messages_profile_created_idx on public.messages (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- send_rate — rate-limit ledger. ONLY hashes are stored (never raw tokens,
-- never raw IPs).
-- ---------------------------------------------------------------------------

create table public.send_rate (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  token_hash text not null, -- HMAC-SHA256(HINT_SECRET, "tk:" || sender cookie)
  ip_hash text not null     -- HMAC-SHA256(HINT_SECRET, "ip:" || shared IP)
);

create index send_rate_token_created_idx on public.send_rate (token_hash, created_at desc);
create index send_rate_ip_created_idx on public.send_rate (ip_hash, created_at desc);

-- Optional retention (run periodically): the app only reads the last 10 minutes.
-- delete from public.send_rate where created_at < now() - interval '7 days';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.send_rate enable row level security;

-- profiles: public pages must be readable without an account (profile link).
create policy "profiles_select_public"
  on public.profiles for select
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- messages: read/delete by the owner only. NO insert policy on purpose:
-- inserts go through the API with the service role (SUPABASE_SECRET_KEY) so a
-- client can never forge hint_color. Anon clients cannot insert at all.
create policy "messages_select_own"
  on public.messages for select
  using (auth.uid() = profile_id);

create policy "messages_delete_own"
  on public.messages for delete
  using (auth.uid() = profile_id);

-- send_rate: service-role only (RLS enabled, no policies).

-- ---------------------------------------------------------------------------
-- Storage: the avatar bucket. The name is `nocap` — it already exists in the
-- local setup; do NOT rename it (renaming breaks existing uploads).
-- Uploads go through POST /api/profile/avatar (service role), reads are public.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nocap', 'nocap', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
