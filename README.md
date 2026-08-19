# Deal Saver

Deal Saver is a Next.js web application for tracking product prices. The current implementation includes authentication, a user-owned watchlist, and generic Phase 3 extraction for safely fetchable product pages.

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

4. Fill in the required values in `.env.local`:

   ```dotenv
   SITE_URL=http://localhost:3000
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   SUPABASE_SECRET_KEY=your-server-only-secret-key
   ```

   Never commit `.env.local`. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the
   low-privilege browser key. `SUPABASE_SECRET_KEY` is the current server-only
   key used for shared extraction profiles and must never use a `NEXT_PUBLIC_`
   name. If the project does not support current secret keys, leave
   `SUPABASE_SECRET_KEY` empty and set the legacy
   `SUPABASE_SERVICE_ROLE_KEY` instead. Do not set both.

5. In Supabase, open **Authentication → URL Configuration** and set:

   - Site URL: `http://localhost:3000`
   - Redirect URL: `http://localhost:3000/auth/callback`

6. In **Authentication → Providers → Email**, ensure email/password authentication is enabled. For local testing, either configure SMTP or use an email address allowed by your Supabase project's built-in test email service.

7. Link the repository to your Supabase project and apply all committed migrations:

   ```bash
   npx supabase@latest login
   npx supabase@latest link --project-ref your-project-ref
   npx supabase@latest db push
   ```

   Find the project reference in the Supabase dashboard URL. The migrations
   create the user-owned `tracked_products` table plus the shared extraction
   profile, acquisition-state, and lightweight AI-run tables. RLS restricts
   tracked products to their owner and prevents normal users from reading or
   modifying shared extraction infrastructure. The CLI may prompt for the
   database password chosen when the project was created.

8. Start the development server:

   ```bash
   npm run dev
   ```

9. Open [http://localhost:3000](http://localhost:3000). Create an account, confirm it through the email Supabase sends, sign in, and visit `/watchlist`.

## Available commands

```bash
npm run dev        # Start the local development server
npm run lint       # Run ESLint
npm test           # Run deterministic extraction tests (no paid API calls)
npm run typecheck  # Run TypeScript without emitting files
npm run build      # Create a production build
npm start          # Serve a completed production build
npm run probe-product -- "https://example.com/product"
```

## Generic product extraction

Signed-in users can paste a public HTTPS product-page URL on `/watchlist`. The
server resolves and pins static requests to public addresses, validates each
redirect, and enforces redirect, timeout, response-size, content-type, and SSRF
limits. It normalizes the name, price, currency, image, source, canonical URL,
product type, price semantics, and confidence before the authenticated user
saves the result through the existing RLS-protected watchlist client.

The extraction order is:

1. Matching saved declarative profile.
2. Schema.org Product/Offer/AggregateOffer JSON-LD, including arrays and
   `@graph`.
3. Product microdata, paired semantic metadata, and bounded embedded
   application JSON, followed by a conservative primary-product-region visible
   price fallback.
4. Optional bounded Cloudflare Browser Run rendering for likely JavaScript
   application shells, followed by the same deterministic extraction.
5. Optional GPT-5.6 Luna profiling that proposes a reusable declarative recipe,
   which the server validates and executes before storing as a candidate.

Pages with missing, conflicting, or ambiguous product data are not saved. The
implementation does not contain retailer-specific logic and does not use
proxies, CAPTCHA bypasses, stealth behavior, AI vision, or model escalation.
Explicit access denials, 403s, and 429s stop before browser or AI fallback.

## Optional browser rendering

Browser rendering is disabled unless all three settings are present:

```dotenv
BROWSER_RENDERING_ENABLED=true
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_BROWSER_API_TOKEN=your-browser-rendering-token
```

Create a custom Cloudflare API token with the account-level
`Browser Rendering - Edit` permission. The app calls only the Browser Run
`/content` endpoint, caps the request at 20 seconds and 5 MB, rejects image,
media, and font loads, and records measured browser time in diagnostics.

## Optional AI profiling

AI profiling is disabled by default. To enable it, set:

```dotenv
AI_PROFILING_ENABLED=true
AI_PROFILE_MODEL=gpt-5.6-luna
AI_PROFILE_MAX_INPUT=30000
OPENAI_API_KEY=your-server-only-openai-api-key
```

Restart the Next.js development server after changing any environment variable;
the running server process does not reliably reload `.env.local` changes.

The model uses reasoning effort `none`, strict Structured Outputs, at most two
attempts per submitted URL, at most 1,200 output tokens, and no automatic model
upgrade. Page reduction defaults to 30,000 characters and is hard-capped at
50,000. Images and full page HTML are not sent. Prompts and page content are not
stored in the application database.

The optional live-provider check is deliberately separate from the normal test
suite because it incurs an API call:

```bash
RUN_AI_PROFILE_INTEGRATION=true npm run test:ai-profile
```

## Development probe

After `.env.local` is configured, inspect one extraction without printing page
HTML:

```bash
npm run probe-product -- "https://example.com/product"
```

The JSON report includes non-secret configuration status and every extraction
stage: fetch/render status and HTML length, application-shell and denial
classification, profile attempts, generic extraction outcomes, exact AI
eligibility or skip reason, candidate validation/persistence, provider token
usage when available, browser time, and the final failure reason.

## Authentication structure

- `src/lib/supabase/client.ts` creates a browser Supabase client.
- `src/lib/supabase/server.ts` creates a cookie-aware server client.
- `src/proxy.ts` refreshes sessions and redirects unauthenticated dashboard and watchlist requests.
- The dashboard and watchlist also verify authenticated claims on the server before rendering.

Scheduled price refreshes, price history, alerts, and notifications are not implemented yet.
