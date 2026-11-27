# Restaurant SaaS menu app

React/Vite customer ordering site and Express/Mongoose API for tenant-isolated restaurant profiles, menus, and orders. This repository is an implementation foundation, not a launch-ready SaaS: see the checklist and external setup limits below.

## Project layout

```text
src/
  components/       Customer menu, hero, and checkout
  data/             Chai Corner development fallback
  pages/            Owner and super admin panels
  services/         Central API client
  App.jsx           Public restaurant menu and order flow
server/
  models/            Restaurant, User, and Order schemas
  index.js           API, authentication, authorization, and business rules
  seed.js            Non-destructive demo/admin account provisioning
```

## Requirements and local setup

- Node.js 20 or newer
- MongoDB Atlas connection string (or a local MongoDB replica set; owner registration uses a transaction)

From the repository root, install and run the frontend:

```sh
npm install
npm run dev
```

In `server/`, install backend dependencies and run the API:

```sh
npm install
npm run dev
```

The Vite app expects the API at `http://localhost:5000` by default. Set `VITE_API_URL` in a root `.env.local` to override it. Copy `server/.env.example` to `server/.env` and set the values locally. In development only, if `JWT_SECRET` is missing or too short, the server generates a persistent key in the ignored `server/.jwt-secret` file. Production requires a configured `JWT_SECRET` of at least 32 characters. Never commit `.env` files or generated secrets.

On Windows, the API falls back to PowerShell DNS resolution for Atlas SRV records when Node's DNS resolver cannot resolve them. Atlas must also allow the developer machine's current public IP under **Network Access**; keep this allowlist narrow rather than opening access to every IP.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Random signing secret, at least 32 characters |
| `PORT` | No | API port, defaults to 5000 |
| `CORS_ORIGINS` | Production | Comma-separated allowed browser origins. Render config includes the production and current Vercel origins; the backend also recognizes project-scoped Vercel preview URLs. `CLIENT_ORIGIN` remains a legacy alias. |
| `OWNER_EMAIL` | Seed only | Email for the initial Chai Corner owner |
| `OWNER_PASSWORD` | Seed only | Initial owner password, at least 10 characters |
| `SUPER_ADMIN_EMAIL` | Seed only | Email for a provisioned platform administrator |
| `SUPER_ADMIN_PASSWORD` | Seed only | Initial admin password, at least 16 characters |
| `CLOUDINARY_CLOUD_NAME` | Image upload only | Cloudinary account name; backend only |
| `CLOUDINARY_API_KEY` | Image upload only | Server-side Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Image upload only | Server-side Cloudinary signing secret; never expose to Vite |
| `VITE_API_URL` | No | Public API base URL compiled into the frontend |

Provision or update the demo data without deleting existing records:

```sh
cd server
npm run seed
```

The seed script creates Chai Corner only when missing. It never resets an existing password or deletes restaurant/order data. Set owner/admin credentials in the server environment before running it. Owner registration at `/owner` is public and only creates the `owner` role; there is no public super admin registration.

## Main routes

- `/` or `/r/:slug` — public restaurant menu and checkout
- `/owner` — owner login, registration, orders, menu, and settings
- `/admin` — provisioned super admin sign-in and restaurant activation
- `GET /api/health` — API/database health
- `GET /api/r/:slug` — public active restaurant menu
- `POST /api/r/:slug/orders` — validate and persist an order; server calculates price
- `/api/owner/*` — authenticated owner data and order management
- `/api/admin/*` — super admin-only platform endpoints

Customer order submission uses cash as the payment method and leaves payment pending. An order is not represented as accepted until the restaurant owner changes its status. WhatsApp sharing is optional and separate from saving an order.

## Deployment notes

1. Create MongoDB Atlas database credentials and allow network access from the backend host.
2. Deploy `server/` as the `menu-app-api` Node service, set `MONGO_URI`, a random `JWT_SECRET` of at least 32 characters, `CORS_ORIGINS`, and `NODE_ENV=production`, then use `npm start`.
3. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in Render to enable image uploads. Images are validated and uploaded from memory to Cloudinary; Render disk is not used for permanent storage.
4. Deploy the repository root to Vercel with `npm run build` and set `VITE_API_URL=https://menu-app-api-i3ap.onrender.com`. Configure SPA fallback routing for `/owner`, `/admin`, and `/r/*`.
5. Run the seed command once with protected owner/admin values in the backend environment. Do not expose these values in frontend environment variables.
6. Verify `/api/health`, sign in, place a small test order, and check that a different owner cannot retrieve it.

## Current implementation checklist

- [x] Existing responsive customer menu, search, category filters, and persistent cart
- [x] Public restaurant lookup by slug and live menu loading
- [x] Owner account registration/login, expiring JWT, role checks, and password change flow
- [x] Restaurant ownership scoping in protected owner APIs
- [x] Server-priced customer orders with item snapshots and unique order numbers
- [x] Owner order polling, detail view, search/date/status filters, lifecycle transitions, and cancellation reasons
- [x] Stored-order daily, weekly, and monthly revenue/order charts, status counts, and popular menu item analytics
- [x] Menu/category CRUD, availability, featured flags, and authenticated Multer memory uploads to Cloudinary
- [x] Restaurant open/closed, hours, minimum order, taxes, delivery settings, and owner profile management
- [x] Tenant-scoped customer history and date-filtered CSV sales reports
- [x] Server-calculated tax/delivery totals and minimum-order/open-status checks at checkout
- [x] Super admin login gate, restaurant overview, listing, activate/suspend endpoints and panel
- [x] Non-destructive demo seed, deployment notes, env example, and secret ignore rules
- [ ] Subscription plan configuration and backend plan-limit enforcement
- [ ] Payment provider integration (requires provider credentials and verified webhooks)
- [ ] Configure Cloudinary credentials before enabling image uploads in a deployment
- [ ] QR generation/download and print layout
- [ ] Admin audit logs and authorized admin account management
- [x] Automated API tests for CORS, auth/roles, tenant scoping, customer order pricing, uploads, and menu saves
- [ ] Full database-backed integration tests, API schema docs, and deployed service verification
- [x] Helmet security headers and bounded express-rate-limit middleware for API and authentication routes
- [ ] A shared rate-limit store for horizontal scaling; the current limiter uses per-process memory and is appropriate only while running a single backend instance.
- [ ] Dedicated Category, Subscription, Payment, AuditLog, and PlatformSettings models/APIs, admin audit logs, and API schema documentation.

Do not consider the platform launch-ready until the incomplete product capabilities above are addressed, a shared rate-limit store is configured before scaling beyond one backend instance, and deployed database, upload, and order flows are verified.
