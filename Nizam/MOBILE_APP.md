# Amma Wears — Mobile App (Ionic + Capacitor)

This is the store-ready iOS and Android app. It ships from the **same Angular
codebase** as the SSR website, but as a completely separate build target — the
website keeps its server rendering, and the app is a pure client bundle wrapped
in an Ionic shell.

| | Website | Mobile app |
|---|---|---|
| Entry point | `src/main.ts` | `src/main.mobile.ts` |
| Angular target | `build` | `build-mobile` |
| Environment | `environment.ts` | `environment.mobile.ts` |
| Output | `dist/Nizam` | `www/browser` |
| Native shell | navbar + footer | Ionic `ion-tabs` |
| Rendering | SSR + hydration | client only |

## Quick start

```bash
npm install
npm run build:mobile      # Angular bundle -> www/browser
npx cap sync              # copy the bundle into android/ and ios/
npx cap open android      # or: npx cap open ios
```

Run `cap sync` whenever the web assets change. `cap update` is only needed when
a Capacitor plugin is added, removed or upgraded.

## npm scripts

| Script | Purpose |
|---|---|
| `build:mobile` | Production mobile bundle (minified, production environment) |
| `watch:mobile` | Development mobile bundle with source maps, rebuilding on change |
| `assets:source` | Regenerates `resources/icon.png` and `resources/splash.png` from the logo |
| `assets:generate` | Derives every native icon/splash size from `resources/` |
| `cap:sync` | `build:mobile` + `cap sync` — the normal edit/run loop |
| `cap:update` | `build:mobile` + `cap update` (after changing plugin versions) |
| `android:run` / `ios:run` | Build, sync and launch on a connected device/emulator |
| `android:build` | Debug APK |
| `android:bundle` | Release AAB (the Play Store upload format) |
| `ios:build` | Release `.xcarchive` (requires macOS + Xcode) |
| `serve:mobile` | Dev server on `0.0.0.0:4200`, reachable from a phone on the LAN |
| `live:android` / `live:ios` | Dev server + sync + launch, with hot reload |

### Building the APK

`android:build` / `android:bundle` invoke Gradle directly, which **requires JDK 21
specifically**. Gradle 8.14 does not understand the newer class-file format, so a
newer JDK fails immediately and somewhat cryptically:

```
> Unsupported class file major version 69
```

That is Java 25. It is not a bug in the project and no `org.gradle.java.home`
tweak in the repo can fix it — Gradle itself rejects the JDK. Point `JAVA_HOME` at
a JDK 21 install before building:

```bash
export JAVA_HOME=/path/to/jdk-21    # then npm run android:build
```

A verified debug build produces
`android/app/build/outputs/apk/debug/app-debug.apk` (~17 MB, `com.ammawears.app`,
targetSdk 36). It is debug-signed, so it installs directly on a phone via
sideload but is not uploadable to Play — `android:bundle` needs the release
signing keystore described below.

### Testing on a device

The normal loop is `npm run cap:sync`, then `npm run android:run` /
`npm run ios:run`. That installs a **bundled** build — what the store will ship.

For faster iteration, `npm run live:android` discovers your machine's LAN
address, starts `ng serve` on `0.0.0.0:4200`, and points the WebView at it, so
edits hot-reload on the phone. Your phone and the computer must be on the same
Wi-Fi. This sets `CAP_SERVER_HOST`, which `capacitor.config.ts` reads; leaving
it unset is what produces the normal offline bundle, so always re-run
`npm run cap:sync` before testing a release build.

Inspecting a running app:

- **Android:** `chrome://inspect` on the desktop Chrome, with the device
  connected and USB debugging on.
- **iOS:** Safari → Develop → *device*, with the device paired to the Mac.

### Running on a device from Codespaces

Codespaces has no USB port, so a phone cannot be attached to it directly. Two
options that do not need the phone plugged into the Codespace:

1. **Bundle the build and install it yourself.** Run `npm run cap:sync` here,
   then copy `Nizam/android/app/build/outputs/apk/debug/app-debug.apk` to the
   phone and open it (allow "install unknown apps" when prompted). This is the
   most reliable option, and it tests the exact bundle the store would ship.
2. **Use the dev server over the public Codespace URL.** Codespaces exposes
   port 4200 on a forwarded domain. Run `npm run serve:mobile` and open
   `https://<codespace>-4200.app.github.dev` in the phone's browser to confirm
   the UI renders. Note this is only the *website-style* shell — the Ionic tab
   bar and native plugins need a real WebView, so use option 1 to test those.

## Requirements: what you can and cannot build here

| Task | Needs | Codespaces (Linux) | 2012 Mac |
|---|---|---|---|
| Website + SSR | Node ≥ 22.12 | ✅ | ✅ (Node 22 runs) |
| Mobile web bundle | Node ≥ 22.12 | ✅ | ✅ (Node 22 runs) |
| Android APK/AAB | Node ≥ 22 + JDK 21 + Android SDK | ✅ | ✅ |
| iOS build/archive | macOS + **Xcode 26+** | ❌ | ❌ |

**Node:** Angular 21 supports Node `^20.19 ‖ ^22.12 ‖ ≥24`, but **Capacitor 8's
CLI requires Node ≥ 22**. `.nvmrc` pins 22. If `npm` warns about engines, use
Node 22 — Node 22.x is the version to install on the older Mac; the newest Node
releases are the ones that dropped support for it.

**Xcode:** Capacitor 8 requires **Xcode 26+** and iOS 15+. Xcode 26 needs a
recent macOS that a 2012 Mac cannot run (its last supported macOS is Monterey,
Xcode 14.x). So the iOS app cannot be compiled or archived on that machine.

To get an iOS build, use GitHub Actions with a `macos-latest` runner, or
Codemagic, which build from the repo without needing local hardware.
## Architecture

### Why a second bootstrap

The website's `src/main.ts` bootstraps with server rendering. The app cannot
use it: there is no server inside a WebView, so the SSR providers would wait
forever for data that is never sent. `main.mobile.ts` bootstraps the same
services client-only, with its own providers.

### Shared services are not modified

Cart, wishlist, auth, catalog, currency, analytics and payment services are the
same modules the website uses. Two things make that work:

- **`MobileApiInterceptor`** rewrites relative `/api/...` requests onto the
  absolute API origin from `environment.mobile.ts`. The WebView origin is
  `capacitor://localhost` (iOS) or `http://localhost` (Android), so an
  unqualified `/api/products` would 404.
- **Interceptor order is load-bearing.** `AuthInterceptor` is registered
  *before* `MobileApiInterceptor` so it matches on the still-relative `/api`
  prefix and attaches the JWT. Reversing the two makes every authenticated
  request return 401 on device while working fine on the website — a genuinely
  confusing failure if you don't know to look for it.

### Styling

- `src/styles.mobile.css` — global: Ionic's CSS entrypoints, brand design
  tokens, Ionic token remaps, safe-area variables, and the shared page chrome
  (`.app-header`, `.app-body`, `.app-section-title`).
- `src/app/mobile/shared/product-card.scss` — the product grid and card, shared
  by the home and shop screens so the two cannot drift apart.
- `src/app/mobile/pages/mobile-login/auth-form.scss` — field styling shared by
  sign-in, register and checkout.

The shared rules are global rather than component-scoped on purpose: Angular's
view encapsulation limits a component stylesheet to its own template, and ten
routed pages all need these classes.

### Safe areas

`viewport-fit=cover` in `src/index.mobile.html` lets the layout extend under the
notch and home indicator; `--ion-safe-area-top/bottom` (from
`env(safe-area-inset-*)`) are then consumed by the header padding and the
bottom bars.

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/` | Home | Hero, category rail, new arrivals |
| `/products` | Shop | Sticky search, category chips, sort |
| `/product/:id` | Product detail | Gallery, size picker, sticky buy bar |
| `/cart` | Cart | Free-shipping progress, quantity stepper |
| `/wishlist` | Saved items | Signed-out, empty and populated states |
| `/account` | Account | Identity, orders, currency, sign out |
| `/checkout` | Checkout | Auth-guarded; hides the tab bar |
| `/orders` | Orders | Auth-guarded |
| `/login`, `/register` | Auth | Preserves `AuthGuard`'s redirect URL |
| `/info/:page` | About / Contact / Shipping & returns | One shared screen |

## Before you ship to the stores

These are the remaining items that cannot be done from this repo alone.

1. **Confirm the API origin.** `src/environments/environment.mobile.ts`
   currently assumes `https://api.ammawears.com`. The CORS allow-list in
   `src/server.ts` must include it, and Android blocks cleartext HTTP, so it
   must be HTTPS.
2. **Confirm the app ID.** `com.ammawears.app` in `capacitor.config.ts`. Once
   published this is permanent — changing it ships an entirely new app, losing
   the install base and reviews.
3. **App icon and splash.** Currently generated from the photo logo via
   `scripts/generate-app-assets.mjs`. Store guidelines generally want a
   dedicated brand mark rather than a photo; swap `resources/icon.png` and
   re-run `npm run assets:generate` if you have one.
4. **Android signing.** Create an upload keystore, keep it out of version
   control, and wire a release signing config into `android/app/build.gradle`.
   `npm run android:bundle` then produces the Play Store upload.
5. **iOS signing.** Requires a macOS machine with Xcode: an Apple Developer
   account, the bundle ID registered in App Store Connect, and a provisioning
   profile. `npm run ios:build` produces the `.xcarchive`.
6. **Privacy declarations.** Both stores require a data-safety form that
   matches reality — this app sends name, email, phone and delivery address to
   the API, and stores the cart, wishlist and session on the device.
7. **Review the GA4 id.** `G-X8Q0VPPQ0K` in the mobile environment should be
   replaced with the live property id if the website uses a different one.

## Known limitations

- Checkout requires `https://checkout.razorpay.com/v1/checkout.js`, loaded in
  `src/index.mobile.html`. If it is blocked, the screen detects the missing
  global and offers cash on delivery rather than failing silently.
- There is no offline catalog beyond whatever `ProductService` already caches;
  losing connectivity shows a toast but does not queue writes.
- Pull-to-refresh and infinite scroll are not implemented — the shared service
  fetches the catalog in a single call.
