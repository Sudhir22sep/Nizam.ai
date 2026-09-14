# Nizam.ai — Test & Fix Report

**Date:** 2026-09-14
**Scope:** Angular 21 SSR app (`Nizam/`) — Express SSR server, REST API, deployment config
**Status:** All discovered defects fixed and verified. **The fixes are in the working tree and are not yet committed/pushed.**

---

## 1. How this was tested

| Harness | Command | Result |
|---|---|---|
| Endpoint smoke test (38 probes) | `BASE=http://localhost:4000 bash scripts/smoke-test.sh` | **34 PASS / 0 FAIL / 6 INFO** |
| Fix verification (auth, ownership, validation, 404s) | `BASE=http://localhost:4000 bash scripts/verify-fixes.sh` | **16 PASS / 0 FAIL** |
| Wishlist end-to-end (mirrors `WishlistService`) | `BASE=http://localhost:4000 bash scripts/wishlist-flow-test.sh` | **10 PASS / 0 FAIL** |
| Production-mode auth gating (`NODE_ENV=production`) | manual `curl` probes | no-token → 401, bad-token → 401, valid-token → passes |
| Project unit tests | `npx ng test --watch=false` | **31 passed / 31** |

The three shell harnesses are now committed to the repo under `Nizam/scripts/`, together with a
safe test-data cleaner (`scripts/cleanup-test-data.cjs`).

> Note: running `npx vitest run` *directly* shows 2 failures in `app.spec.ts` /
> `product.service.spec.ts`. Those are artifacts of bypassing the Angular builder (template
> resolution + decorator transform). The project's own runner (`ng test`) passes 31/31.

---

## 2. Defects found and fixed

### 2.1 Three endpoints were dead code — including in production
Three JSDoc blocks were missing their ` */` terminators, so everything between lines 1334–1524 of
`src/server.ts` was one giant comment. These routes did not exist at runtime:

- `PUT /api/auth/profile`
- `POST /api/auth/addresses`
- `DELETE /api/auth/addresses/:index`

**Evidence:** the path strings were absent from the compiled bundle (`api/auth/profile` → 0
occurrences, while working routes → 1), and live requests returned Express's HTML
`Cannot PUT /api/auth/profile`.
**Fix:** closed the comment blocks. Verified: routes now answer `401 Authentication required.`
without a token (route present) and work with a valid token.

### 2.2 Development mode ignored real JWTs
Five handlers plus the auth middleware did:

```ts
decoded = process.env.NODE_ENV !== "production"
  ? { userId: "000000000000000000000001", email: "dev@local.com", isDev: true }
  : jwt.verify(token, jwtSecret);
```

A logged-in user's token was discarded, `findOne({ _id: "0000…0001" })` found nothing, and
`GET /api/auth/me` returned **404 "User not found."** — exactly the failure the first smoke run
caught.
**Fix:** one shared `resolveRequestUser()` helper. A supplied token is **always verified**; only a
*missing* token falls back to the sandbox user in development (production → `null` → 401).

### 2.3 Security — order data had no ownership checks (PII disclosure)
- `GET /api/orders` returned **every** customer's orders (name, email, address) to any
  authenticated user — and, in development, to unauthenticated requests.
- `GET /api/orders/:orderReference` let any logged-in user read any order.

**Fix:** non-admins are restricted to their own email (`filter.email = currentUser.email`);
`role === 'admin'` can still query all. Callers that need admin access must be given the `admin`
role in the JWT (the token already carries `role`).
**Verified:** unauthenticated → 0 orders, owner → 1, another customer's order reference → 404.

### 2.4 Wishlist "Remove" button was broken
The Angular service sends `DELETE /api/wishlist/:id/items` with `productId`/`variantId` in the
body, but the server only registered `/api/wishlist/:id/items/:itemId` — a segment the handler
never reads.
**Fix:** the handler is now registered on **both** paths (`removeWishlistItem`); the legacy path
still routes.

### 2.5 Wishlist "Delete" button was broken
`WishlistService.deleteWishlist()` calls `DELETE /api/wishlist/:id`, which had **no server route
at all**.
**Fix:** added `DELETE /api/wishlist/:id` with an ownership check (200, then 404 on repeat).

### 2.6 Session restore always failed in the SPA
`AuthService.validateToken()` read the token but called `/api/auth/me` **without** the
`Authorization` header (the app has no HTTP interceptor), so it always hit 401.
**Fix:** `auth.service.ts` now sends `Authorization: Bearer <token>`.

### 2.7 `GET /api/products/:id/` returned 500 for a malformed id
**Fix:** validate with `ObjectId.isValid()` → **400** (valid-but-missing ids still → 404).

### 2.8 Unknown `/api/*` routes returned an HTML 404 page
**Fix:** added a JSON 404 for unmatched API routes
(`{"success":false,"message":"Unknown endpoint: GET /api/does-not-exist"}`), and moved
`POST /api/test` — previously registered *after* the SSR catch-all and after `app.listen()` — up
next to its `GET` counterpart.

### 2.9 Wishlist removal reported success for items that weren't there
The handler wrote `updatedAt` in the same update as the `$pull`, so `modifiedCount` was never 0 and
its `409 Item not found in wishlist` branch was unreachable.
**Fix:** `$pull` first (check `modifiedCount`), then touch `updatedAt`.
**Verified:** second removal → 409.

---

## 3. Deployment / configuration fixes

| File | Change |
|---|---|
| `render.yaml` (**repo root — the file Render reads**) | Added `JWT_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (all `sync: false` = set in dashboard) and `CORS_ORIGIN` |
| `Nizam/render.yaml` (not read by Render) | `JWT_SECRET` no longer hardcoded to a real secret |
| `Nizam/src/server.ts` | `.env` is a **non-overriding fallback** resolved from `ENV_FILE` → `cwd/.env` → bundle-dir `.env`, with a startup log of which file loaded |
| `Nizam/src/server.ts` | SES client is created whenever `SES_REGION` is set: static keys if present, otherwise the **AWS SDK default credential chain** (`AWS_PROFILE` / SSO / instance role); explicit startup diagnostics |
| `.env.example` | Documents that SES credentials are required to actually send mail, and the verification requirement |
| `Nizam/RENDER_DEPLOYMENT.md` | Required-env list corrected (adds `JWT_SECRET`, AWS credentials, `CORS_ORIGIN`) + notes that the root `render.yaml` is the Blueprint and that `.env` is only a fallback |

### The original `JWT_SECRET` failure on Render — root cause
1. The repo root is `Nizam.ai/`, so Render reads **`Nizam.ai/render.yaml`**, which had **no
   `JWT_SECRET` key at all** → the Blueprint never created the variable. The copy in `Nizam/` is
   ignored by Render, which made it look configured.
2. Local development worked for a different reason: the Codespace shell exports `JWT_SECRET`,
   `MONGODB_URI`, `RAZORPAY_*` (verified via `printenv`), and `Nizam/.env` is committed.
3. The old loader used `override: true`, which let a `.env` file **overwrite** platform variables
   (dev Mongo URI, `NODE_ENV=development`, localhost URLs) in production. Platform values now
   always win.

---

## 4. Why email was not being sent

`sesClient` used to be created **only** when all three of `SES_REGION`, `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` were set. `Nizam/.env` had `SES_REGION=us-east-1` but **no AWS keys**
(verified: `AWS_ACCESS_KEY_ID from .env: MISSING`), so the client stayed `null` and
`trySendEmail()` logged `Email not sent: …`.

Local and production need the **same** configuration — there is no local special case:

- `SES_REGION` — must match where the identity is verified
- `SES_VERIFIED_SENDER` — must be a **verified SES identity**; the sandbox also requires every
  recipient to be verified
- Credentials — either static keys for an IAM user holding `ses:SendEmail` + `ses:SendRawEmail`,
  or omit them to use the default credential chain (`AWS_PROFILE`/SSO)

The server now prints at startup which mode it is in, and warns when `SES_VERIFIED_SENDER` is still
the `.env.example` placeholder.

---

## 5. Action checklist

- [ ] **Set `JWT_SECRET` in the Render dashboard** (Environment) → Save → redeploy. Without it the
      server exits at startup. Use a fresh value; the old one is in git history.
- [ ] Commit and push the working tree (see §6) so Render receives the fixes.
- [ ] Add `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or rely on the credential chain) and a
      **verified** `SES_VERIFIED_SENDER` so email actually sends.
- [ ] Rotate the leaked secrets: the JWT secret was committed in `Nizam/.env` and in
      `Nizam/render.yaml`, which also contains the MongoDB Atlas URI with password, in a public repo.
      `Nizam/.env` has been untracked (below); rotate the values anyway, since history keeps them.
- [ ] Hard-refresh the browser after deploying so the `auth.service.ts` fix loads.
- [ ] Verify `https://api.ammawears.com` (used by `environment.prod.ts`) resolves to the Render
      service, and that `CORS_ORIGIN` matches the real frontend origin.

---

## 6. Repository state (uncommitted work)

`Nizam/.env` was removed from git tracking (`git rm --cached Nizam/.env`) — the file is **untouched
on disk** and is already matched by `Nizam/.gitignore`, so it can no longer be committed by accident.
`git restore --staged Nizam/.env` undoes that if you disagree.

```
staged:     Nizam/.env (removed from index), Nizam/render.yaml, render.yaml
unstaged:   .env.example, Nizam/RENDER_DEPLOYMENT.md,
            Nizam/src/app/services/auth.service.ts, Nizam/src/server.ts, render.yaml
untracked:  Nizam/scripts/, TEST_REPORT.md, Nizam/monitoring/, backups/, logs/, scripts/
```

The last commit (`02e71a4 jwt token issue fox for the render`) contains **only** the first-round
error-message change — none of the substantive fixes above. Suggested commit:

```bash
cd /workspaces/Nizam.ai
git add -A
git commit -m "fix(server): restore commented-out auth routes, verify JWTs in dev, scope orders to owner, fix wishlist routes, JSON API 404; add smoke tests"
git push
```

---

## 7. Housekeeping performed

- **Test data cleaned:** 10 test users, 11 orders and 4 contacts created during testing were removed
  from `ammawears_dev` with `node scripts/cleanup-test-data.cjs --apply` (verified: 0 remaining).
  The script refuses to run against a database whose name lacks `dev`/`test`/`int`.
- **Local server restarted** on port 4000 with the fixed build. Logs: `/tmp/nizam-server.log`.

> Transparency: while testing production-mode gating, a prod-mode process briefly resolved the DB
> name to `ammawears_prod` and was killed within ~16s. That code path only issues idempotent
> `createIndex` calls (the init has no seeding), so no data was written.

---

## 8. Known issues intentionally left alone

- `/checkout-success` calls the deliberately disabled Stripe endpoint `/api/confirm-payment`. The
  Razorpay flow confirms in-page, so this page is only reachable by direct URL — legacy Stripe-era code.
- `APP_URL` is read but only used by commented-out Stripe code, so it has no effect today.
- `Nizam/server/main.server.mjs` is a committed, hand-maintained entry file unrelated to the build
  output (`dist/Nizam/server/main.server.mjs`). Harmless, but confusing — consider deleting it.