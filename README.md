# Deal Saver

Deal Saver is a Next.js web application for tracking product prices. This repository currently contains only the Phase 1 foundation: TypeScript, Tailwind CSS, Supabase authentication, route protection, a landing page, and an authenticated dashboard placeholder.

## Prerequisites

- Node.js 20.9 or newer
- npm
- A free [Supabase](https://supabase.com/) project

## Local setup

1. Install dependencies:

   ```bash
   npm ci
   ```

2. In the Supabase dashboard, open the project's **Connect** dialog and copy its project URL and publishable key.

3. Copy the environment-variable template:

   ```bash
   cp .env.example .env.local
   ```

4. Fill in `.env.local`:

   ```dotenv
   SITE_URL=http://localhost:3000
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

   Never commit `.env.local`. The publishable key is intended for application clients; do not use a Supabase service-role key here.

5. In Supabase, open **Authentication → URL Configuration** and set:

   - Site URL: `http://localhost:3000`
   - Redirect URL: `http://localhost:3000/auth/callback`

6. In **Authentication → Providers → Email**, ensure email/password authentication is enabled. For local testing, either configure SMTP or use an email address allowed by your Supabase project's built-in test email service.

7. Start the development server:

   ```bash
   npm run dev
   ```

8. Open [http://localhost:3000](http://localhost:3000). Create an account, confirm it through the email Supabase sends, sign in, and visit `/dashboard`.

## Available commands

```bash
npm run dev        # Start the local development server
npm run lint       # Run ESLint
npm run typecheck  # Run TypeScript without emitting files
npm run build      # Create a production build
npm start          # Serve a completed production build
```

## Authentication structure

- `src/lib/supabase/client.ts` creates a browser Supabase client.
- `src/lib/supabase/server.ts` creates a cookie-aware server client.
- `src/proxy.ts` refreshes sessions and redirects unauthenticated dashboard requests.
- The dashboard also verifies authenticated claims on the server before rendering.

No application database schema or later MVP features are included in Phase 1.
