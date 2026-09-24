<div align="center">

# 🔏 UnGNL

Anonymous messages, honestly. Share your profile link, get honest questions and
feedback — with a colour hint that is **not** an identity.

![desktop screenshot](./public/preview.png)

</div>

## ✨ Features

- **Anonymous Q&A**: Anyone can send you questions or feedback — no account needed
- **Unique Profile Links**: Share your link anywhere to start receiving messages
- **Colour hints, not identities**: each message gets a pastille extracted from
  *your* photo. Same browser → often the same colour. Several strangers share
  one colour. It is not a name, not a proof — UnGNL never claims to know who
  wrote a message
- **Colour-hint lab** (`/demo`): try the exact pipeline (sharp → node-vibrant →
  OKLab filter, max 6 colours) without an account
- **Real-Time Inbox**: Read and manage messages instantly
- **Profile Controls**: Toggle message reception, check username availability
- **Modern UI**: Built with Next.js, Tailwind, Shadcn-UI, and Squircle.js
- **Supabase DB, Auth & Storage**: Secure, scalable backend

## 🧰 Tech Stack

- Next.js 15 (pinned 15.3.8)
- React 19
- TypeScript
- Tailwind CSS
- Supabase (SSR, Auth, Storage)
- Shadcn UI
- Tanstack Query
- Zod
- Motion
- sharp + node-vibrant (colour-hint palette)

## 💻 Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   corepack pnpm install
   ```
3. Set up your `.env.local` from `.env.example` (Supabase keys + `HINT_SECRET`)
4. Apply `supabase/migrations/0001_init.sql` to your Supabase project
5. Run the dev server:
   ```bash
   corepack pnpm dev
   ```
6. Open [http://localhost:3000](http://localhost:3000) and try `/demo`

See [MVP.md](./MVP.md) for the full state of the MVP (schema, colour-hint
mechanics, env vars, OAuth URLs, out-of-scope list).

## 🛠️ Development

- Next.js App Router
- Supabase for backend
- TypeScript, ESLint, Prettier
- Tailwind CSS for styling

## 📜 License

MIT

## 💙 Acknowledgements

UnGNL is a fork of [handshek/nocap](https://github.com/handshek/nocap) (MIT),
itself forked from [buneeIsSlo/nocap](https://github.com/buneeIsSlo/nocap).

- [Supabase](https://supabase.com/)
- [Squircle.js](https://squircle.js.org/)
- [Shadcn UI](https://ui.shadcn.com)
- [Tanstack Query](https://tanstack.com/query/latest)
