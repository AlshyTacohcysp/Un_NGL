# UnGNL — état du MVP (color-hint)

> Ce document décrit l'état courant du MVP **UnGNL**, alternative honnête à
> NGL.link : lien de profil, messages anonymes, pastille de couleur extraite de
> la photo du destinataire. Lire aussi le code avant de modifier ; ne pas
> réécrire l'app.

## Règle produit (non négociable)

La pastille **n'est pas une identité** :

- même navigateur = souvent même couleur (un seul token par navigateur) ;
- plusieurs inconnus partagent une couleur (c'est un modulo sur 6 couleurs max) ;
- ce n'est ni un nom, ni une preuve ;
- **ne jamais promettre « on sait qui a écrit »** (ni en UI, ni en doc, ni en
  marketing).

## Stack réelle

- Next.js **15.3.8** (ne pas upgrade avant une ouverture publique), React 19,
  Tailwind 4, shadcn, Supabase SSR, pnpm (via corepack)
- Package name : `ungnl` — nom public : **UnGNL** (ne pas renommer)
- Branches : travail sur `main` côté produit ; commits de référence :
  - `Add color-hint MVP on top of Nocap`
  - `Rename the public app to UnGNL`
- Le dépôt d'origine (nocap) n'avait **aucun SQL**. Le schéma canonique est
  `supabase/migrations/0001_init.sql`.

## Schéma (`supabase/migrations/0001_init.sql`)

- `profiles` : `id` (= auth.users), `email`, `username`, `bio`, `avatar`,
  `accepting_messages`, **`palette text[]`** (max 6 `#rrggbb`).
- `messages` : `profile_id`, `content` (5..200), **`hint_color`** (instantané au
  moment de l'envoi), + colonnes legacy nocap (`sender_id`,
  `is_sender_authenticated`, `is_sender_visible`).
- `send_rate` : `token_hash`, `ip_hash`, `created_at` — **que des hash**, jamais
  de token ni d'IP en clair. Purge possible au-delà de 7 jours (commentaire SQL).
- Le CHECK sur la palette **ne contient pas de sous-requête** (sinon Postgres
  sort `0A000` : *cannot use subquery in check constraint*). Toute la
  validation hex est dans `public.palette_hex_ok(palette text[])`, appelée par
  les CHECK (`profiles.palette`, `messages.hint_color` via `array[hint_color]`).
- RLS : lecture/suppression des messages par le propriétaire seulement,
  **pas d'insert anon** (l'insert passe par la service role). `send_rate` : RLS
  activée, aucune policy (service role uniquement). `profiles` : lecture
  publique (lien de profil), insert/update par le propriétaire.
- Bucket Storage : **`nocap`** — ne pas le renommer (cela casserait l'upload
  déjà créé en local). Public en lecture, écriture uniquement via la route
  avatar avec la service role. Limites bucket : 2 Mo, JPEG/PNG/WebP/GIF.

## /demo — labo sans compte

- Même pipeline que le réel : **sharp décode, node-vibrant extrait, filtre
  OKLab, max 6 couleurs** (`src/lib/palette.ts`).
- Le filtre OKLab garde des couleurs visibles et distinctes (ni gris, ni
  quasi-noir, ni quasi-blanc) ; repli sur les candidats bruts si tout est filtré
  (photo en niveaux de gris).
- Deux messages envoyés avec le **même token de démo partagent la même
  pastille**. Le labo affiche une empreinte de token (fingerprint HMAC) pour le
  montrer.
- Rien n'est stocké côté serveur (hors cookie palette httpOnly d'1 h) ; le labo
  ne consomme pas `send_rate`.

## Envoi — `POST /api/messages`

- Le client n'envoie que `profile_id` et `content` (zod ; les champs en trop
  sont ignorés — pas de `hint_color` côté client).
- Cookie httpOnly **`nc_sender`** : UUID aléatoire par navigateur (1 an,
  sameSite lax, secure en prod).
- Couleur = `HMAC-SHA256(HINT_SECRET, destinataire + token)` modulo la palette
  du destinataire, stockée dans `messages.hint_color` **au moment de l'envoi** :
  - changer de photo ne recolore **pas** l'historique ;
  - **pas d'IP** dans le calcul de couleur ;
  - palette vide/absente → pas de pastille (et pas d'erreur).
- L'insert passe par la **service role** (`SUPABASE_SECRET_KEY`) : avec un
  client classique, un client pourrait forger `hint_color`.
- Rate limit : **8 / 10 min par navigateur** (hash du token) et **30 / 10 min par
  IP partagée** (hash de l'IP) via `send_rate`. Seuls des HMAC-SHA256 y sont
  écrits.
- Le `GET` (propriétaire) renvoie `hint_color` ; le `DELETE` reste RLS-own.

## Upload photo — `POST /api/profile/avatar`

- **Seule** route qui peut modifier l'avatar et la palette. JPEG, PNG, WebP,
  GIF (détecté par sniffing sharp, pas seulement le MIME déclaré), **2 Mo**.
- Upload dans le bucket `nocap` (`avatars/<user>-<ts>.<ext>`), URL publique
  stockée sur le profil, palette extraite et enregistrée en même temps.
- `PUT /api/profile/update` **ignore l'id du body** (cible = user authentifié)
  et n'accepte que `username` + `bio` — avatar/palette n'y passent jamais.

## Auth (Google via Supabase)

Le bouton envoie `redirectTo = origin + /auth/callback`. Deux URL à ne pas
confondre :

| Où | Quelle URL |
| --- | --- |
| **Google** → Authorized redirect URI | `https://REF.supabase.co/auth/v1/callback` (**pas localhost**) |
| **Supabase** → Redirect URLs | `http://localhost:3000/auth/callback` (+ l'URL Vercel plus tard) |

- Site URL local = `http://localhost:3000`. Ouvrir **localhost**, pas
  `127.0.0.1`.
- Le crash Google venait d'une clé absente du bundle client, pas d'OAuth :
  `NEXT_PUBLIC_` est une règle Next.js — sans ce préfixe, `createBrowserClient`
  jette « URL and API key are required » au clic Google.

## Env (`.env.example`)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — valeur `eyJ…` (ancienne anon) ou
  `sb_publishable_…` (nouvelle) : les deux sont valides. **Ne pas inventer de
  préfixe `sb.`**
- `SUPABASE_SECRET_KEY` — `eyJ…` (ancien service_role) ou `sb_secret_…`
- `HINT_SECRET` — `openssl rand -base64 32`, **jamais** `NEXT_PUBLIC_`
- Le code accepte aussi les anciens noms `NEXT_PUBLIC_SUPABASE_ANON_KEY` et
  `SUPABASE_SERVICE_ROLE_KEY`.
- Après **toute** modif de `.env.local` : arrêter et relancer `pnpm dev`.

## Lancer

```bash
corepack pnpm install && corepack pnpm dev
```

puis http://localhost:3000 et http://localhost:3000/demo.

## Hors scope (ne pas faire sauf demande explicite)

- scraping Instagram (`instagram.com/?__a=1` ou équivalent)
- Instagram Graph / Login (v2, comptes Creator/Business seulement ; Basic
  Display est mort depuis le **4 décembre 2024** ; URL CDN à télécharger dans
  Storage)
- SQLite / SQLCipher (demandé puis abandonné : prod = Supabase)
- modération, signalement, blocage
- upgrade Next au-delà de 15.3.8 (à faire avant ouverture publique, pas
  maintenant)

## Git / déploiement

- Le fork public est `AlshyTacohcysp/Un_NGL` (fork de `handshek/nocap`, MIT,
  lui-même issu de `buneeIsSlo/nocap`). **Ne jamais pousser vers
  `handshek/nocap`.** L'utilisateur poussera ses branches lui-même.
- Local : `git remote` peut être absent selon l'environnement ; rien n'est
  perdu tant que les commits sont faits localement.
