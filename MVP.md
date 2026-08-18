# Deal Saver — Broke Solo Developer MVP

## 1. Purpose of This File

This file defines what should be built **right now**.

The goal is not to build the final Deal Saver platform.

The goal is to build the cheapest, simplest version that proves users want to save products and come back when prices drop.

Codex should treat this file as the active implementation scope.

If a feature is described in `REQUIREMENTS.md` but not included here, do not build it yet.

---

## 2. MVP Goal

Build a web app where a user can:

1. Create an account
2. Paste a product URL from a supported retailer
3. Save the product to a watchlist
4. See its current price
5. See historical prices
6. Set a target price
7. Have the backend refresh prices on a schedule
8. Receive an email when the price falls enough
9. Click through to the retailer

---

## 3. Constraints

This project is being built by a solo developer with a very small budget.

Optimize for:

- Free tiers
- Low infrastructure cost
- Simple architecture
- Easy debugging
- Easy local development
- Minimal maintenance
- Fast iteration

Avoid clever infrastructure unless clearly necessary.

---

## 4. Preferred Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS

### Backend

Use Next.js server-side functionality unless a separate service is clearly needed.

### Database / Auth

- Supabase
- PostgreSQL
- Supabase Auth

### Hosting

Prefer a low-cost/free deployment setup such as:

- Vercel for the web app
- Supabase for database/auth

Do not introduce Kubernetes, microservices, Kafka, or other heavy infrastructure.

---

## 5. Supported Retailers

Start with **one retailer integration**.

Do not attempt to support the whole internet.

The integration layer should still be structured so additional retailers can be added later.

Once the first retailer works reliably, add a second retailer.

---

## 6. Product Creation Flow

The user should be able to paste a product URL.

Example:

`https://retailer.com/product/example`

The server should attempt to extract:

- Product name
- Product image
- Current price
- Retailer name
- Canonical URL if available

The user should then be able to save the product.

If automatic extraction fails, return a clear error.

Do not build a universal AI-powered parser in the MVP.

---

## 7. Watchlist

Create a `/watchlist` page.

Each tracked product should display:

- Product image
- Product name
- Store
- Current price
- Previous price if available
- Price change
- Target price
- Last checked time
- Link to product details
- Link to retailer

Users should be able to:

- Add a product
- Remove a product
- Update target price

---

## 8. Product Detail Page

Create a product detail page.

Display:

- Product image
- Product name
- Retailer
- Current price
- Target price
- Lowest recorded price
- Last checked
- Product URL

Also display a simple price history table.

A chart may be added only after the table works.

---

## 9. Price History

Store price observations.

Minimum required fields:

- id
- tracked_product_id
- price
- checked_at

When a refresh occurs:

1. Fetch current product price
2. Compare with saved current price
3. Save a new history record when appropriate
4. Update current price
5. Update last checked timestamp

Avoid writing duplicate history rows unnecessarily when the price has not changed unless keeping periodic observations is useful.

---

## 10. Target Price Alerts

A user can optionally set a target price.

Example:

Current price: $399  
Target price: $349

If a refreshed price is less than or equal to the target:

- Create an alert record
- Send an email notification

Prevent repeatedly sending the same alert every refresh while the product remains under the target.

---

## 11. Email Notifications

Use a low-cost/free email provider.

The notification should contain:

- Product name
- Old price
- New price
- Amount saved
- Retailer
- Product link

Push notifications are out of scope.

---

## 12. Background Price Refresh

Use a simple scheduled job.

The MVP does not require real-time checking.

A reasonable initial frequency is:

- 1–4 checks per day

The schedule should be configurable.

Do not refresh prices every few minutes.

---

## 13. MVP Database Schema

### tracked_products

- id
- user_id
- retailer
- product_url
- product_name
- image_url
- current_price
- target_price
- last_checked_at
- created_at

### price_history

- id
- tracked_product_id
- price
- checked_at

### alerts

- id
- user_id
- tracked_product_id
- type
- old_price
- new_price
- created_at
- sent_at

Use Supabase Auth for users rather than creating unnecessary custom authentication tables.

---

## 14. Retailer Integration Structure

Create a simple adapter/interface.

Example conceptual structure:

`lib/retailers/`

- `types.ts`
- `index.ts`
- `retailer-one.ts`

Each retailer adapter should expose something conceptually similar to:

- `supportsUrl(url)`
- `getProduct(url)`

`getProduct()` should return normalized data such as:

- name
- price
- imageUrl
- retailer
- url

Do not scatter retailer-specific scraping logic throughout UI components or API routes.

---

## 15. Error Handling

Handle common failures clearly:

- Unsupported retailer
- Invalid URL
- Product not found
- Price not found
- Retailer temporarily unavailable
- Product page changed
- Network failure

Store enough error information for debugging without exposing sensitive internals to users.

---

## 16. Security

Minimum requirements:

- Users may only access their own tracked products
- Use Supabase Row Level Security where appropriate
- Validate URLs server-side
- Do not expose service-role secrets to the browser
- Validate numeric price inputs
- Rate-limit product creation if abuse becomes an issue

---

## 17. MVP Monetization

Do not build subscriptions yet.

Prepare the architecture so retailer links can later become affiliate links.

For now:

- Keep product destination URLs centralized
- Avoid hard-coding outbound links throughout the frontend
- Create a simple redirect route if useful, such as `/go/[id]`

Once affiliate programs are available, that redirect can generate the appropriate affiliate URL.

---

## 18. Out of Scope

Do **not** build these during the MVP:

- Whole-store scraping
- Store bookmarking
- Personalized store deal feeds
- Universal retailer support
- Cross-store product matching
- Automatic cheapest-price comparison
- AI shopping assistant
- AI price prediction
- Native iOS app
- Native Android app
- Browser extension
- Push notifications
- SMS alerts
- Coupon aggregation
- Cashback
- Social features
- Comments
- Deal voting
- Sponsored deals
- Premium subscriptions
- Used-market tracking
- International pricing
- Loyalty integrations

These belong in later phases.

---

## 19. Implementation Order

Build in this order:

### Phase 1 — Foundation

- Initialize Next.js project
- Configure TypeScript
- Configure Tailwind
- Configure Supabase
- Authentication
- Protected routes

### Phase 2 — Watchlist

- Database schema
- Add tracked product
- Watchlist page
- Remove product
- Edit target price

### Phase 3 — First Retailer

- Retailer adapter interface
- First retailer parser
- Extract product information
- Save initial price

### Phase 4 — Price History

- Scheduled refresh job
- Save price changes
- Product detail page
- Price history table

### Phase 5 — Alerts

- Detect target-price condition
- Store alert
- Send email
- Prevent duplicate alerts

### Phase 6 — Monetization Preparation

- Centralized outbound redirect
- Click tracking
- Affiliate-ready retailer configuration

### Phase 7 — Second Retailer

Only add the second retailer after the first integration and refresh pipeline are stable.

---

## 20. Definition of Done

The MVP is successful when the following flow works reliably:

1. User creates an account
2. User pastes a supported retailer URL
3. Deal Saver recognizes the product
4. Deal Saver saves the product and current price
5. User sees the product in their watchlist
6. The scheduled job refreshes the product later
7. A new price is stored in history
8. The watchlist reflects the new price
9. An alert email is sent when the target condition is reached
10. User can click through to the retailer

At that point, stop adding features and test whether real users actually find the product useful.
