# Ice & Cocktail Mixers Express

A quick-commerce web app for **party ice, craft tonic water, flavoured club soda, margarita mixes, bitters and dehydrated citrus garnishes**, plus party bundles and non-alcoholic party essentials. The business goal is roughly 10-minute delivery; the app only ever shows an **estimate** based on real service-area data, never a guarantee.

- **Client:** React 19, Vite, TypeScript, Tailwind CSS v4, React Router, Axios, Lucide
- **Server:** Node, Express, TypeScript, Prisma, PostgreSQL
- **Money:** integer minor units (paise) everywhere, formatted only at display time (₹).

> **All catalog prices are development sample data** (`priceStatus = SAMPLE`, labelled "Sample price · unverified"). No retailer or manufacturer page could be read to confirm them, so no MRP, discount, rating or availability claim is made. See "Catalog data".

## Scope

Sold categories (fixed, enforced in `server/src/lib/catalog.ts`): **Ice Bags, Tonic Water, Club Soda, Margarita Mixes, Bitters, Citrus Garnishes, Party Bundles, Party Essentials**. There are no alcoholic products or categories. A product outside these active categories is invisible to customers and rejected by the cart, quote and order APIs even if its id is known.

## Setup

Requirements: Node 20+, PostgreSQL 14+.

```bash
createdb icemixers && createdb icemixers_ci     # icemixers_ci is used (and truncated) by the API tests

cd server
cp .env.example .env              # set DATABASE_URL and JWT_SECRET (>= 32 chars)
npm install
npx prisma migrate deploy
npm run db:seed                   # catalog, bundles, sample delivery areas, discount codes, admin user
cd ../client && npm install
cd .. && npm install && npm run dev   # API :4000, web :5173 (Vite proxies /api)
```

Admin login: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (defaults `admin@example.com` / `ChangeMe123!`: change them). Codes: `WELCOME10` (10% over ₹200), `FLAT50` (₹50 over ₹400).

## Environment (`server/.env`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `JWT_SECRET` | required |
| `CLIENT_ORIGIN`, `PORT` | CORS origin / API port |
| `TAX_RATE_BPS`, `DELIVERY_FEE_MINOR`, `FREE_DELIVERY_THRESHOLD_MINOR` | pricing config |
| `ENABLE_COD` | cash on delivery (card payments are **not implemented**; the UI shows them as unavailable) |
| `ALLOW_SAMPLE_PRICES` | default true in dev, false in production: with false, products with a SAMPLE price are hidden and cannot be bought |
| `PINCODE_API_URL` | postal PIN lookup (default India Post public API `https://api.postalpincode.in/pincode`) |
| `REVERSE_GEOCODE_URL`, `GEOCODER_USER_AGENT` | optional GPS reverse geocoding (default OpenStreetMap Nominatim: set a real contact in the user agent and respect its usage policy) |

## Delivery, PIN codes and addresses

- **Nationwide lookup.** Any six-digit PIN the postal provider knows resolves: there is no state, city or PIN list in the code (the provider returned 18/18 test PINs across states and UTs). A well-formed PIN the provider does not know is reported as *no record*, never assumed valid. The state **code** (ISO 3166-2:IN, e.g. MH, TN, JK) is derived from the state name by `server/src/lib/states.ts` (all 28 states + 8 UTs, incl. the names India Post uses such as *Pondicherry* and *Jammu & Kashmir*) because the provider returns names only; it is computed on the server and stored with saved addresses and order snapshots. Lookups are cached in memory (24 h found / 1 h not-found, never failures; bounded to 5000 PINs; concurrent identical lookups share one upstream call) and the endpoint is rate-limited (120/min per IP).
- **Postal lookup is not serviceability.** `GET /api/pincode/:pin` returns two separate answers: `postal` (area / district / state suggestions from India Post, or `not_found`, or `unavailable` with the real failure message) and `delivery` (from the `ServiceArea` table: serviceable, `not_covered`, or `paused`). A failing postal service never hides the delivery answer and never fakes a result; manual entry always works.
- Delivery coverage and ETAs live in `ServiceArea` (Admin → Delivery areas). Seeded rows (Ranchi, Hazaribag, Gurugram, Delhi) are **sample data**: replace them with your real coverage.
- Addresses: house/flat, street/locality, area (post office), district, state, landmark (optional), 6-digit PIN (kept as a string) and an optional GPS pair and a contact mobile number. Typing six digits triggers a debounced lookup (400 ms, 12 s client / 7 s server timeout); every PIN change cancels the previous request, so a slow old answer can never overwrite a newer PIN. Area, district and state are filled only into empty fields (or fields the app filled itself), never over the customer's edits; with several post offices the customer chooses one. GPS is opt-in (browser permission), reverse-geocoded on the server, and nothing is filled until the customer confirms. Each order stores an immutable address snapshot (incl. area, district and coordinates); the admin order view shows it with an OpenStreetMap link when coordinates exist. Editing or deleting a saved address never changes past orders.
- PIN states shown to customers: *Enter a valid 6-digit PIN code* · *Looking up location…* · *Area and state detected* · *Delivery available* · *Sorry, delivery is not available in this area.* · *Unable to verify delivery. Please try again.* (with Retry). If only the postal service is down, delivery is still answered and manual entry stays open.
- Checkout validates the address and serviceability on the server before ordering, and orders to a non-serviceable PIN are refused (HTTP 422).

## Catalog data: prices and images

Single source: `server/prisma/catalog.ts` (+ `catalog-media.ts` for SKUs, pack-size groups and photos) (seed with `npm run db:seed`); also editable in **Admin → Products**.

- `VERIFIED` prices need a source URL and date (HTTP 400 otherwise). MRP and discount % are only stored/shown for verified prices; discounts are computed, never invented.
- **Images (verified 2026-10-28):** all 8 category images and all 19 product images are real photos (representative stock photos plus three owner-supplied pack images) (Pexels / Unsplash; credits in `client/public/img/stock/CREDITS.json`). They are *representative* photos of the kind of item, labelled as such on the product page, and no stock photo is reused for two products. Schweppes Indian Tonic 300 ml, Bisleri Club Soda 750 ml and Svami Original 200 ml use pack images supplied by the store owner (`client/public/img/products/`, source/licence recorded as owner-supplied; shown uncropped on a cream background). Every product now has an image; the neutral "coming soon" image remains only as the fallback for a product saved without one, and no other brand's packaging or invented packaging is ever shown. Photo, SKU and pack-size data live in `server/prisma/catalog-media.ts`; category images in `catalog.ts`. To add a real product photo, save it under `client/public/img/` (lowercase file names; paths are case-sensitive on Linux), edit that file or use Admin → Products → Images (live preview, http(s)/`/path` only), reseed (or just save in Admin) and run `npm run catalog:check-images` in `server/`: it checks every product and category image exists with the exact letter case, is a real image file, and is not reused. Category tiles and banners use `CoverImage` (object-cover under a dark gradient, no retry loop on failure); product photos use `ProductImage` (reserved width/height, lazy loading, one-time local fallback).
- Images record `isPlaceholder`, `sourceUrl`, `license`. Representative stock photos (Pexels / Unsplash, credits in `client/public/img/stock/CREDITS.json`) are labelled "representative photo, not the exact product" on the product page. Branded items without a licensed photo use a neutral "coming soon" image. No cocktail/alcohol photography is used as product imagery. `npm run catalog:check-images` (in `server/`) verifies every image loads and writes `prisma/image-report.json`.
- To verify a price: set `status: "VERIFIED"`, `mrp`, `sourceUrl`, `verifiedAt` in `catalog.ts` (or the admin form) and reseed.

## Product details, pack sizes and the price filter

- Every product has an internal **SKU** (`ICX-<category>-<n>`, editable in Admin) and may belong to a **pack-size group** (`variantGroup`): products in one group are shown as selectable pack sizes on each other's page (e.g. Party Ice 1 kg / 5 kg), each with its own price and stock. Ingredients appear only when verified from the label (none are yet).
- **Price filter:** separate Min / Max inputs (decimals allowed), validation (numbers only, min ≤ max), Apply, Reset, Clear all filters, and a range slider built from `GET /api/products/price-range` (the real cheapest/dearest listed prices for the current category). Filters live in the URL; price/stock/sort are also remembered for the browser tab and carried to the next listing when the price range still overlaps its products.
- Dark mode uses the espresso/amber palette (`#211811` background, `#2A1D14` cards, `#D6A04A` accent, `#FFF5E6` text, `#C7B39B` secondary, `#51402F` borders).

## Architecture notes

- **Server-side pricing and stock.** `POST /api/orders` accepts only product ids + quantities; prices, discount, delivery fee, tax and total are computed server-side. Stock is decremented atomically (`stock >= qty`) so concurrent orders cannot oversell; cancelling restores stock. `expectedTotalMinor` makes a changed price a 409 instead of a surprise charge.
- **Approved catalog guard** in `lib/publish.ts` is used by listing, detail, search, cart, quote, orders and bundles.
- **Auth:** bcrypt, JWT in an `httpOnly` `sameSite=lax` cookie; role is re-read from the DB on every request; other users' orders return 404.
- **Security:** helmet, CORS allow-list, rate limits, zod validation, generic 500s.
- **Theme:** all colours are CSS variables in `client/src/index.css` (ivory/espresso/amber light, espresso/amber-gold dark); the header sun/moon toggle persists in `localStorage`. The customer delivery banner and category pills are not rendered on `/admin`.

## API (all under `/api`)

Auth `register|login|logout|me`; Products `GET /products` (`q, category, minPrice, maxPrice, inStock, sort, page, pageSize`), `GET /products/:idOrSlug`, admin `POST|PUT|DELETE` (delete archives products with order history); `GET /categories`; `GET /search/suggest`; Cart `POST /cart/quote`, `GET|POST /cart/items`, `PATCH|DELETE /cart/items/:id`; Orders `POST /orders`, `GET /orders` (`?all=true` admin), `GET /orders/:id`, `PATCH /orders/:id/status`; Addresses CRUD + `POST /addresses/validate`; `GET /pincode/:pin`, `GET /delivery/check`, `GET /delivery/areas`, `POST /geo/reverse`, `GET /config`, `GET /bundles`; Admin `stats`, bundles / discounts CRUD, `service-areas`, `customers`.

## Database migrations

`prisma/migrations/20261027000000_baseline` is the schema as it existed; `20261028010000_address_area_district` adds `area`/`district` to addresses and the order snapshot; `20261027010000_ice_mixers_scope` is the controlled scope change: alcohol products/categories were removed from active listings (products with order or bundle history are archived, never deleted; empty alcohol categories were deleted), the category tree was flattened into the eight categories above, and the alcohol/variant tables and columns were dropped. Orders, users and addresses are untouched.

## Tests

```bash
cd server && npm test     # 79 tests: auth, catalog scope, search/filter/sort, admin product CRUD, quotes, cart, PIN lookup + serviceability (fetch mocked), addresses, orders (concurrency, stock, snapshot, scope), admin
cd client && npm test     # 76 tests: cart/filter/PIN/format/api helpers, product card, layout (admin banner rules), PIN modal with the real provider, address form (PIN lookup, multiple post offices, races, failures, GPS)
```

Server tests need the `icemixers_ci` database migrated (`DATABASE_URL=… npx prisma migrate deploy`); **they truncate it**. Override with `TEST_DATABASE_URL`.

## Troubleshooting

"Can't reach the API server (HTTP 502)": the Vite proxy cannot reach the backend. Start both with `npm run dev` (from the project root or from `client/`), check PostgreSQL and `DATABASE_URL`, or set `API_PROXY_TARGET`. In production serve client and API behind one domain, or build the client with `VITE_API_URL` and set `CLIENT_ORIGIN`.

## Open items for the operator

Replace sample prices/coverage/policy pages; add licensed product photos; configure online payments (not implemented); set a real `GEOCODER_USER_AGENT`; change the seeded admin password.
#   I c e - C o c k t a i l - M i x e r s -  
 
## Deployment: Vercel (frontend) + Render (backend)

Folders: `client/` is the frontend (React + Vite), `server/` is the backend (Express + Prisma + PostgreSQL).

### Backend on Render (Web Service)

| Setting | Value |
| --- | --- |
| Root Directory | `server` |
| Build Command | `npm install --include=dev && npx prisma generate && npm run build && npx prisma migrate deploy` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Environment variables (Render dashboard → Environment):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | your Render PostgreSQL connection string (use the *Internal* URL) |
| `JWT_SECRET` | a random string of 32+ characters |
| `NODE_ENV` | `production` |
| `CLIENT_ORIGIN` | `https://ice-cocktail-beta.vercel.app` (comma-separate several origins; a trailing slash is tolerated) |
| `ALLOW_SAMPLE_PRICES` | `true` while the catalogue still has sample prices. **Without it, production hides every product with an unverified price, so the shop looks empty.** |
| `COOKIE_SAMESITE` | `none` **only** if the browser calls the API directly (see Vercel option 2); leave unset for option 1 |
| `MONGODB_URI` | optional: your MongoDB Atlas connection string. When set, sign-up/sign-in credentials (email + bcrypt hash) are stored in Atlas. Paste the real value **only** here (Render secret), never in code, `VITE_` variables or Git |
| `MONGODB_DB` | optional, default `icemixers`: the Atlas database used for accounts |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | the admin you want created by the seed |

Create the data **once**: open the Render **Shell** for the service and run `npm run db:seed` (it creates categories, products, bundles, sample delivery areas, discount codes and the admin). **Do not re-run it on a live shop:** it resets products, bundles, delivery areas and discount codes to the values in `server/prisma/catalog.ts` (so edits made in Admin, such as stock and prices, would be overwritten). Customers, addresses, carts and orders are never touched by the seed. `migrate deploy` only creates or updates tables: it never resets or deletes data.

Database: the app uses **PostgreSQL** (Prisma). On Render create a *PostgreSQL* instance in the same region as the web service and paste its **Internal Database URL** into `DATABASE_URL` (an external URL needs `?sslmode=require`). PostgreSQL always holds the shop data (orders, carts, addresses). `DATABASE_URL` must start with `postgresql://`; a `mongodb://` value there makes every request fail.

Verify the backend from any browser or terminal:

- `https://ice-cocktail-mixers.onrender.com/api/health` → `{"ok":true}` (server is up)
- `https://ice-cocktail-mixers.onrender.com/api/health/db` → `{"ok":true,"db":true,"categories":8}`. If it returns 503 it names the cause without exposing secrets: `P2021` = tables missing (run `npx prisma migrate deploy`), `PrismaClientInitializationError`/`P1001` = wrong or unreachable `DATABASE_URL`.
- `https://ice-cocktail-mixers.onrender.com/api/categories` → the 8 categories (the bare base URL `/` is not an endpoint and returns 404 by design; every route lives under `/api`).

The free Render plan sleeps when idle: the first request can take 30-60 s (the app waits up to 45 s and offers Retry).

### Frontend on Vercel

| Setting | Value |
| --- | --- |
| Root Directory | `client` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |

`client/vercel.json` provides (1) the single-page-app fallback so deep links such as `/category/tonic-water` do not 404, and (2) a rewrite of `/api/*` to the Render backend.

Choose **one** way to reach the API:

1. **Recommended: rewrite (same-origin).** Leave `VITE_API_URL` **unset**. The browser calls `https://ice-cocktail-beta.vercel.app/api/...`, Vercel forwards it to Render. No CORS, and the login cookie stays `SameSite=Lax`. If your backend URL ever changes, edit the destination in `client/vercel.json`.
2. **Direct calls.** Set `VITE_API_URL=https://ice-cocktail-mixers.onrender.com` (Production; the `/api` suffix is added automatically). Then the backend **must** have `CLIENT_ORIGIN=https://ice-cocktail-beta.vercel.app` and `COOKIE_SAMESITE=none`. Some browsers block third-party cookies, which can break login in this mode: option 1 avoids that.

`VITE_` variables are baked into the bundle **at build time** and are public: never put secrets in them. **After adding, changing or removing a `VITE_` variable you must redeploy** (Vercel → Deployments → ⋯ → Redeploy, untick "Use existing build cache"). Pushing the code changes triggers a deployment too, and the backend must be redeployed for the CORS/cookie fixes to take effect.

### What was wrong on the first deployment

- The frontend was built with no `VITE_API_URL`, so it called Vercel's own `/api/*` (404 on every request).
- Vercel answers such requests with `{"error":{"code","message"}}`; the error handler assumed `error` was always text, so React received an object and crashed ("Minified React error #31"), which showed *Something went wrong displaying this page*. It now accepts any response shape and shows a readable message with Retry.
- Deep links returned 404 (no SPA fallback), and `CLIENT_ORIGIN` had a trailing slash, which never matches a browser's `Origin` header, so CORS would have blocked every call even with the URL fixed.
- The Render database endpoints returned HTTP 500; use `/api/health/db` (above) to see why. The most likely causes are tables not created or an unseeded database; the second is the production sample-price rule (`ALLOW_SAMPLE_PRICES`).

### User accounts in MongoDB Atlas (optional)

With `MONGODB_URI` set, sign-up and sign-in use Atlas: the `users` collection in database `MONGODB_DB` stores the email (unique, lower-case), name, phone and a **bcrypt hash** of the password. No plaintext password, OTP or token is stored. PostgreSQL keeps a password-less profile row with the same id so orders, carts and addresses keep working. Accounts that already exist in PostgreSQL are copied to Atlas on their first sign-in (same id, nothing deleted). Without `MONGODB_URI` the app behaves exactly as before. This is email + password sign-in; Google/Gmail OAuth ("Sign in with Google") is not implemented.

Atlas setup:

1. **Rotate the password** of any database user whose connection string was shared, and prefer a dedicated user: Atlas → Database Access → Add New Database User → role *Read and write to a specific database* → `icemixers` only.
2. Atlas → Network Access → allow Render to connect. Render's outbound IPs are listed in the service's *Connect* menu; `0.0.0.0/0` also works but is less strict.
3. Render → Environment → add `MONGODB_URI` (and optionally `MONGODB_DB`), then redeploy.

Test it: `/api/health/db` shows `"mongo":{"configured":true,"ok":true}`. If not, `reason` is `AUTH_FAILED` (wrong user/password), `UNREACHABLE` (Network Access / host) or `BAD_URI`. Then sign up on the site, sign out, sign in again; the user appears in Atlas → Browse Collections → `icemixers.users`. If Atlas is down, sign-in returns a safe 503 and the rest of the shop keeps working.

### Online payments with Razorpay (test mode first)

Customers can pay by UPI or card with Razorpay Standard Checkout; Cash on Delivery keeps working. How it works: the order is saved first (stock reserved, payment `PENDING`), the server creates the Razorpay order for the **server-computed total**, the browser pays, and the server marks the order paid only after it verifies the signature **and** asks Razorpay for the real payment status and amount. A webhook confirms payments even if the customer closes the tab. Paid orders are ordinary PostgreSQL orders, so they appear in the admin Orders tab with an "Online · paid" badge.

Render environment variables (backend only; the secret is never sent to the browser or logged):

| Variable | Value |
| --- | --- |
| `RAZORPAY_KEY_ID` | `rzp_test_...` from Razorpay Dashboard → Account & Settings → API keys (Test mode) |
| `RAZORPAY_KEY_SECRET` | the matching secret |
| `RAZORPAY_WEBHOOK_SECRET` | a secret you choose; use the same value in the webhook below |
| `RAZORPAY_ALLOW_LIVE` | leave unset. Live keys (`rzp_live_...`) are ignored unless this is `true` |

Razorpay Dashboard (switch to **Test Mode**):
1. Webhooks → Add: URL `https://ice-cocktail-mixers.onrender.com/api/payments/razorpay/webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `order.paid`, `payment.failed`.
2. Test payment: choose "Pay online" at checkout. UPI success: `success@razorpay`; UPI failure: `failure@razorpay`. Test card: `4111 1111 1111 1111`, any future expiry, any CVV, OTP `1234` if asked.
3. Check `GET /api/payments/config` returns `{"enabled":true,"testMode":true}`, then the order shows as paid in My orders and in Admin → Orders.

Refunds are not automatic: paid online orders are cancelled by an admin and refunded from the Razorpay Dashboard. Before going live, verify test mode end to end, then replace the keys with live keys and set `RAZORPAY_ALLOW_LIVE=true`.
