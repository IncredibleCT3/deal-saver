# Deal Saver — Product Requirements

## 1. Product Overview

Deal Saver is a price-tracking and deal discovery app that lets users save stores and products they care about, then automatically watches for price drops and sales over time.

Core value proposition:

> Bookmark what you want. We'll watch the price.

The long-term product has two main tracking modes:

1. **Store Watch** — Users bookmark stores or store pages and Deal Saver surfaces newly discounted items over time.
2. **Product Watch** — Users bookmark individual products and Deal Saver tracks their prices over time, including the cheapest current offer across supported retailers.

---

## 2. Product Goals

Deal Saver should help users:

- Avoid manually checking product pages for price drops
- Avoid manually checking store sale pages
- Know whether a current sale is actually good based on historical pricing
- Find the cheapest current retailer for a product
- Receive alerts when products reach a desired price
- Keep a personal watchlist of products they intend to buy

---

## 3. Primary User Flows

### Product Tracking Flow

1. User signs in
2. User pastes a supported product URL
3. Deal Saver extracts product information
4. User saves the product
5. Deal Saver stores the current price
6. Background jobs periodically refresh the price
7. New prices are added to price history
8. User receives an alert when configured conditions are met
9. User clicks through to the retailer

### Store Tracking Flow

1. User selects or pastes a supported store/store-page URL
2. Deal Saver saves the store watch
3. Deal Saver periodically refreshes that source
4. Newly discounted products are detected
5. Relevant deals appear in the user's personalized feed

---

## 4. User Accounts

Users should eventually be able to:

- Create an account
- Sign in
- Sign out
- Reset password
- Delete account
- Manage profile
- Manage notification preferences

Preferred authentication options:

- Email/password
- Google
- Apple

---

## 5. Product Watchlist

Users should be able to:

- Add a product by URL
- Save a target price
- Remove a product
- View the current price
- View previous price
- View price change
- View the store
- View the product image
- View when the product was last checked
- View price history
- Open the retailer page

Each tracked product should eventually support:

- Product name
- Brand
- Product URL
- Image
- Retailer
- Current price
- Original/list price
- Target price
- Availability
- Last checked time
- Product identifiers when available

---

## 6. Price History

Deal Saver should store price observations over time.

Each observation should include:

- Product or offer reference
- Price
- Store
- Timestamp

Users should be able to view:

- Current price
- Previous observed price
- Lowest recorded price
- Highest recorded price
- Price change
- Historical price grid
- Historical price chart

---

## 7. Cheapest Current Price

Long-term, Deal Saver should support matching the same product across multiple retailers.

Example:

Sony WH-1000XM6

- Amazon — $399
- Best Buy — $379
- Target — $419

Deal Saver should calculate:

**Current Best Price: $379 at Best Buy**

---

## 8. Cross-Store Product Matching

Product matching should prioritize reliable identifiers in this order:

1. UPC / GTIN
2. Manufacturer model number
3. Retailer SKU mappings
4. Brand + model
5. Normalized product title
6. Fuzzy matching
7. AI-assisted matching as a fallback

AI should not be the primary matching mechanism.

---

## 9. Store Watch

Users should eventually be able to bookmark:

- A retailer
- A retailer category page
- A retailer sale page

Deal Saver should periodically refresh supported store sources and detect:

- Newly discounted items
- Deeper discounts
- Newly available products
- Products returning to stock

Do not create one crawler per user. Shared store pages should be fetched centrally and reused for all users following that source.

---

## 10. Personalized Deal Feed

The home feed should primarily contain deals relevant to stores and products the user follows.

Potential filters:

- Biggest discount
- Lowest price
- Recently discounted
- New deals
- Store
- Brand
- Category

---

## 11. Alerts

Supported alert types should eventually include:

- Any price drop
- Target price reached
- New lowest recorded price
- Major discount threshold
- Restock

Notification channels:

- In-app
- Email
- Push notifications

---

## 12. Deal Quality

Deal Saver should eventually compare a sale price against historical pricing rather than trusting retailer marketing.

Example:

Retailer says:

- Was $599
- Now $399

But historical data shows the product usually sells for $419.

Deal Saver should be able to display a more useful interpretation such as:

- 5% below typical recent price
- Lowest price in 90 days
- Near historical low

---

## 13. Retailer Integrations

Retailers should be treated as independent integrations.

Possible data sources:

- Official retailer APIs
- Affiliate APIs
- Affiliate product feeds
- Partner feeds
- Structured metadata
- Permitted page parsing/crawling

Each retailer integration should be isolated so one retailer changing its site does not break the entire application.

Each integration may need:

- Retailer name
- Domain
- Extraction strategy
- Refresh frequency
- Price parser
- Product parser
- Availability parser
- Affiliate configuration
- Health status
- Last successful refresh
- Last error

---

## 14. Background Refresh System

The backend should periodically refresh tracked resources.

Refresh frequency should eventually be dynamic.

Examples:

- Popular products: more frequent
- Popular store pages: more frequent
- Low-interest products: less frequent
- Stable products: gradually reduce refresh rate
- Major shopping events: increase refresh rate

Do not hard-code the refresh frequency throughout the application.

---

## 15. Suggested Long-Term Data Model

### users

- id
- email
- name
- created_at

### stores

- id
- name
- domain
- logo_url
- affiliate_program
- status

### store_watches

- id
- user_id
- store_id
- source_url
- created_at

### products

- id
- brand
- name
- model_number
- upc
- image_url
- category
- created_at

### offers

- id
- product_id
- store_id
- product_url
- current_price
- original_price
- availability
- last_checked_at

### product_watches

- id
- user_id
- product_id
- target_price
- created_at

### price_observations

- id
- offer_id
- price
- observed_at

### alerts

- id
- user_id
- product_id
- type
- triggered_price
- triggered_at
- read

---

## 16. Monetization

### Primary: Affiliate Revenue

Deal Saver should redirect eligible retailer clicks through affiliate links where available.

Flow:

1. User sees tracked product or deal
2. User clicks "View Deal"
3. Deal Saver records the click
4. User is redirected through an affiliate-enabled destination
5. Deal Saver may earn a commission if the user purchases

Affiliate relationships should be disclosed where required.

### Future: Deal Saver+

Potential premium features:

- More tracked products
- Faster refreshes
- Multiple target-price rules
- Longer price history
- Advanced alerts
- Restock alerts
- Advanced filtering
- Historical deal analytics
- Price prediction

### Future: Sponsored Deals

Sponsored listings may be supported later, but:

- They must be clearly labeled
- They must not override the actual cheapest price
- Paid placement must not corrupt price rankings

---

## 17. Admin Dashboard

The internal admin interface should eventually show:

### Integration Health

- Stores
- Last refresh
- Successful checks
- Failed checks
- Parser errors

### Product Data

- Duplicate products
- Missing identifiers
- Low-confidence product matches
- Incorrect matches

### Usage

- Active users
- Active watches
- Price checks per day
- Alerts sent
- Deal clicks

### Revenue

- Affiliate clicks
- Affiliate conversions
- Revenue by retailer
- Premium subscriptions

---

## 18. Major Technical Risks

### Retailer Data Reliability

Websites may:

- Change HTML
- Require JavaScript
- Rate-limit requests
- Block automation
- Change product identifiers
- Restrict automated access

Use APIs, feeds, structured data, and permitted crawling wherever possible.

### Product Matching

Different stores may describe the same product differently.

Build product matching carefully and rely on structured identifiers before fuzzy or AI matching.

### Infrastructure Cost

Do not refresh every tracked URL independently when multiple users track the same product or page.

Deduplicate tracked resources and share refresh results.

---

## 19. Long-Term Success Metrics

### Acquisition

- New users
- Signup conversion

### Engagement

- Products watched per user
- Stores watched per user
- Weekly active users
- Alerts opened
- Deal-feed views

### Deal Performance

- Price drops detected
- Multi-retailer products
- Average detected savings
- Deal clicks

### Monetization

- Affiliate click-through rate
- Affiliate conversions
- Revenue per active user
- Premium conversion rate

---

## 20. Product Loop

The core loop should remain simple:

User saves something  
→ Deal Saver watches it  
→ Price changes  
→ User gets alerted  
→ User returns  
→ User saves more things

Everything in the product should strengthen this loop.
