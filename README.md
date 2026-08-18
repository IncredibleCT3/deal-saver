# Deal Saver

Deal Saver is a Next.js web application for tracking product prices. The current implementation includes the Phase 1 foundation and the Phase 2 manual watchlist with user-owned tracked products.

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

7. Link the repository to your Supabase project and apply the tracked-products migration:

   ```bash
   npx supabase@latest login
   npx supabase@latest link --project-ref your-project-ref
   npx supabase@latest db push
   ```

   Find the project reference in the Supabase dashboard URL. The committed migration creates `tracked_products`, its constraints and index, and Row Level Security policies that restrict every operation to the authenticated owner. The CLI may prompt for the database password you chose when creating the project.

8. Start the development server:

   ```bash
   npm run dev
   ```

9. Open [http://localhost:3000](http://localhost:3000). Create an account, confirm it through the email Supabase sends, sign in, and visit `/watchlist`.

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
- `src/proxy.ts` refreshes sessions and redirects unauthenticated dashboard and watchlist requests.
- The dashboard and watchlist also verify authenticated claims on the server before rendering.

Retailer extraction, price refreshes, price history, and notifications are not implemented yet.
