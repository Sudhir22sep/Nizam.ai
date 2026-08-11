# Mobile Migration Guide: From Angular Web to Ionic (Capacitor) using a Monorepo
## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Why a Monorepo?](#why-a-monorepo)
4. [Setting up the Monorepo with Nx](#setting-up-the-monorepo-with-nx)
5. [Extracting Shareable Code](#extracting-shareable-code)
6. [Scaffolding the Ionic Application](#scaffolding-the-ionic-application)
7. [Integrating Capacitor](#integrating-capacitor)
8. [Wiring Shared Libraries into the Mobile App](#wiring-shared-libraries-into-the-mobile-app)
9. [Migrating UI Components](#migrating-ui-components)
10. [Handling Platform‑Specific Code](#handling-platform-specific-code)
11. [Styling & Theming](#styling--theming)
12. [Testing Strategy](#testing-strategy)
13. [CI/CD Pipeline](#cicd-pipeline)
14. [Building & Releasing](#building--releasing)
15. [Estimated Effort](#estimated-effort)
16. [Risks & Mitigations](#risks--mitigations)
17. [Checklist](#checklist)
18. [References & Further Reading](#references--further-reading)

---

## Overview
This guide walks you through migrating the existing **Angular web application** (the Nizam.ai e‑commerce platform) to a **cross‑platform mobile app** built with **Ionic + Angular + Capacitor**, while keeping a single codebase for both web and mobile via a **monorepo**.  

The approach lets you:

* Reuse services, models, guards, interceptors, and utility code unchanged.
* Keep UI components in a shared library (or copy them over gradually) and adapt them to Ionic’s native look where desired.
* Deploy the web app exactly as before (no impact on existing production).
* Produce Android & iOS binaries from the same source.

## Prerequisites
| Tool | Version (tested) | Installation |
|------|------------------|--------------|
| Node.js | ≥18.x (LTS) | https://nodejs.org |
| npm or yarn | npm ≥10.x / yarn ≥1.22 | Comes with Node |
| Angular CLI | ≥17.x | `npm i -g @angular/cli` |
| Ionic CLI | ≥7.x | `npm i -g @ionic/cli` |
| Capacitor | ≥6.x | `npm i @capacitor/core @capacitor/cli` |
| Nx (optional but recommended) | ≥18.x | `npm i -g nx` |
| Git | any | – |
| (Optional) Android Studio / Xcode | for building native binaries | – |

Ensure you can run the existing web app locally:

```bash
npm install
npm run start   # or ng serve
# Should be reachable at http://localhost:4200
```
## Why a Monorepo?
* **Single source of truth** – services, models, interceptors live once.
* **Atomic updates** – a bug fix in a shared lib is instantly available to both web and mobile.
* **Shared tooling** – one ESLint/Prettier config, one Jest setup, one CI pipeline.
* **Incremental migration** – you can keep the current web app untouched while you experiment with mobile.
* **Better IDE navigation** – jump from a service to its usage in either target without context switching.

We'll use **Nx** because it has first‑class support for Angular libraries and can generate Ionic/Capacitor apps with minimal configuration.
## Setting up the Monorepo with Nx

### 1. Create the Nx workspace (if you don’t already have one)
```bash
# From the repository root
npx create-nx-workspace@latest nizams-monorepo --preset=angular
# Choose:
#   - Application name: web (will hold the existing web app)
#   - Stylesheet format: SCSS (or your preference)
#   - Enable Angular Server‑Side Rendering (SSR): No (we already have SSR via @angular/ssr)
#   - Enable lazy loading: Yes
#   - Install plugins: @nx/angular, @nx/jest, @nx/cypress (we’ll add Ionic later)
```

After the command finishes, you’ll have:

```
nizams-monorepo/
├─ apps/
│   └─ web/                ← your current Angular app (to be migrated)
├─ libs/
│   └─ (empty for now)
├─ nx.json
├─ package.json
�└─ ...
```

### 2. Move the existing web app into the Nx workspace
* Copy the entire current `src/` folder (and any config like `angular.json`, `tsconfig*.json`) into `apps/web/`.
* Adjust the `projects.web` section in `angular.json` if needed (Nx will have generated a default; you can replace it or merge).
* Run `nx serve web` to verify the web app still works.

> **Tip:** If you encounter path errors, run `nx migrate --run-migrations` or manually adjust the `tsconfig.base.json` `paths` to point to the correct locations.

### 3. Generate a shared library for platform‑agnostic code
```bash
nx g @nx/angular:lib shared --importPath=@nizams/shared
```
This creates `libs/shared` with an NG module.

You can also create more specific libraries later (e.g., `ui`, `models`, `core`) but for clarity we’ll start with a single `shared` lib and split later if needed.
## Extracting Shareable Code

### What belongs in the shared library?
| Category | Examples | Reason |
|----------|----------|--------|
| **Models / Interfaces** | `Product`, `Order`, `User`, `Wishlist`, `CartItem` | Pure TypeScript, no DOM. |
| **Services** | `ProductService`, `CartService`, `WishlistService`, `AuthService`, `CurrencyService` | HTTP calls, business logic; usable anywhere. |
| **Guards** | `AuthGuard` | Route protection logic. |
| **Interceptors** | `AuthInterceptor`, `ErrorInterceptor` | HTTP layer. |
| **Utilities** | date formatters, currency converters, validation helpers, JWT helpers | Stateless functions. |
| **Constants** | API endpoints, pagination limits, role strings | Configuration. |
| **NG Modules** (optional) | `SharedModule` that re‑exports common pipes, directives | For reuse in both apps. |

### Migration Steps
1. **Create sub‑folders inside `libs/shared/src/lib`** (e.g., `models/`, `services/`, `guards/`, `interceptors/`, `utils/`, `constants/`).
2. **Move files** from `apps/web/src/app` (or wherever they live) into the appropriate folder.
   * Example: move `src/app/services/product.service.ts` → `libs/shared/src/lib/services/product.service.ts`.
3. **Update imports** in the web app:
   ```ts
   // Before
   import { ProductService } from './services/product.service';
   // After
   import { ProductService } from '@nizams/shared';
   ```
   If you kept sub‑folders:
   ```ts
   import { ProductService } from '@nizams/shared/services';
   ```
4. **Provide services** – if they were previously providedIn: 'root', they stay the same; just ensure the library is exported correctly.
   The generated library already has:
   ```ts
   @NgModule({})
   export class SharedModule {}
   ```
   You can add `export * from './lib/services/product.service';` in the public API (`libs/shared/src/index.ts`) to simplify imports.
5. **Run the web app**: `nx serve web`. Ensure no compilation errors and that the UI works exactly as before.

### Splitting the library (optional but recommended)
As the shared code grows, split it to keep compile times low and to allow independent versioning:
* `libs/core` – services, guards, interceptors.
* `libs/models` – interfaces.
* `libs/utils` – helpers.
* `libs/ui` – reusable dumb components (buttons, cards, modals) that are purely presentational.

You can generate each with `nx g @nx/angular:lib <name> --importPath=@nizams/<name>`.
## Scaffolding the Ionic Application

### 1. Generate an Ionic/Angular app with Nx (or Ionic CLI)
You have two options; pick the one you prefer.

**Option A – Ionic CLI (simpler)**
```bash
cd apps
npx @ionic/cli start mobile blank --type=angular
# This creates apps/mobile with an Ionic starter.
```

**Option B – Nx + manual Ionic install**
```bash
nx g @nx/angular:app mobile --routing --style=scss
# Then add Ionic:
cd apps/mobile
npm i @ionic/angular @ionic/core
```
We'll proceed with **Option A** because it gives you the Ionic project structure out‑of‑the‑box.

### 2. Verify the Ionic starter works
```bash
cd apps/mobile
npm run ionic:serve   # or `ionic serve`
```
You should see the default Ionic blank template running at `http://localhost:8100`.

### 3. Add Capacitor
```bash
npm i @capacitor/core @capacitor/cli
npx cap init
```
When prompted:
* **App name:** Nizam (or any)
* **Package ID:** com.nizam.app (or similar)
* **Web Dir:** `www` (Ionic’s default build output)

### 4. Build the web assets for Capacitor
```bash
npm run build   # Ionic’s build command (ng build) outputs to www/
npx cap copy    # copies web assets into native projects
npx cap add android   # or ios
npx cap open android   # opens Android Studio; you can run on emulator/device
```
You should see the Ionic app running natively.

### 5. Adjust `angular.json` for the mobile project
If you used the Ionic CLI starter, it already has its own `angular.json`. Ensure the **outputPath** points to `www` (default) and that the **baseHref** is `"/"`.

If you prefer to have a single `angular.json` at the workspace root (Nx style), you can add a new project entry for `mobile`. For simplicity, we’ll keep the Ionic CLI’s config and later align scripts.

### 6. Make the mobile app consume the shared library
1. In `apps/mobile/tsconfig.json` add a path mapping (if not already present):
   ```json
   {
     "compilerOptions": {
       "baseUrl": ".",
       "paths": {
         "@nizams/shared/*": ["../libs/shared/src/lib/*"],
         "@nizams/shared": ["../libs/shared/src/index.ts"]
       }
     }
   }
   ```
2. Replace any scaffolded services (e.g., a dummy `DataService`) with imports from `@nizams/shared`.
3. Ensure `AppModule` imports `SharedModule` (or the individual modules you split):
   ```ts
   import { SharedModule } from '@nizams/shared';
   @NgModule({
     imports: [
       BrowserModule,
       IonicModule.forRoot(),
       AppRoutingModule,
       SharedModule   // ← shared code
     ],
   })
   export class AppModule {}
   ```
4. Run `npm run ionic:serve` again – the app should now behave like the web version (same API calls, same data).
## Integrating Capacitor
Capacitor bridges the web build to native projects. The key steps are:
1. `npx cap init` – creates `capacitor.config.json`.
2. `npm run build` – produces the web assets in `www/`.
3. `npx cap copy` – copies `www/` into each native platform folder.
4. `npx cap add <platform>` – creates the Android/iOS project.
5. `npx cap open <platform>` – opens Android Studio / Xcode for further configuration or building.

All Angular code (including the shared library) resides in the web build, so no extra changes are needed beyond ensuring the build output is up‑to‑date.
## Wiring Shared Libraries into the Mobile App
The steps described in **Scaffolding the Ionic Application** (section 6) already wired the shared library:
* Added a path mapping in `tsconfig.json`.
* Imported services from `@nizams/shared` instead of local files.
* Imported `SharedModule` (or feature modules) into `AppModule`.

If you split the shared library into multiple libs (core, models, ui, etc.), repeat the path mapping for each and import the respective modules where needed.
## Migrating UI Components

### Strategy: Incremental, component‑by‑component
1. **Identify high‑reuse, presentational components** (e.g., product card, header, footer, button, badge).  
   These usually contain little to no Angular‑specific logic beyond inputs/outputs.

2. **Create a UI library** (optional but clean):
   ```bash
   nx g @nx/angular:lib ui --importPath=@nizams/ui
   ```
   Move the component into `libs/ui/src/lib/<component>/`.

3. **Adjust the component** to work in both environments:
   * Remove direct DOM access (`window`, `document`) – if needed, abstract behind a service.
   * Replace custom CSS classes with Ionic utility classes or Ionic components where you want a native look.
   * Keep the component’s API (`@Input()/@Output()`) unchanged so the web app can keep using it.

4. **Consume the UI library** in both apps:
   * Web: `import { ProductCardComponent } from '@nizams/ui';` in a module’s declarations.
   * Mobile: same import; Ionic’s theme will automatically style it.

5. **Iterate**: continue moving components until most of the UI is shared. For screens that need a distinctly native feel (e.g., a side‑menu, modal, tab bar), you can replace the whole page with Ionic’s native components (`ion-menu`, `ion-tabs`, `ion-modal`) while still pulling data from the shared services.

### Handling Browser‑Only APIs
If a component uses `window.localStorage` or `sessionStorage`, those are **available in Capacitor** (the web view runs inside a WKWebView/Android WebView, which supports the same storage APIs). So you can keep them as‑is.

If a component uses a library that depends on `window` or `document` in a way that Capacitor does not support (e.g., a chart library that loads external scripts), wrap it:

```ts
// libs/shared/src/lib/services/chart.service.ts
@Injectable({ providedIn: 'root' })
export class ChartService {
  private chartLib: any;

  async loadChart(canvas: HTMLCanvasElement, data: any) {
    if (this.isWeb()) {
      const Chart = await import('chart.js');
      // … use Chart …
    } else {
      // Capacitor: maybe use native chart via a plugin or a web‑compatible fallback.
    }
  }

  private isWeb(): boolean {
    return !(Capacitor.isNativePlatform());
  }
}
```
Then inject `ChartService` wherever needed.
## Handling Platform‑Specific Code

Create a **device abstraction layer** so the same import works everywhere.

### Example: Camera Service
```ts
// libs/shared/src/lib/services/device.service.ts
import { Injectable } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

@Injectable({ providedIn: 'root' })
export class DeviceService {
  async takePicture(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
      // Web fallback: return a placeholder or open file picker
      return null;
    }
    const image = await Camera.getPhoto({
      quality: 90,
      allowEditing: true,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
    });
    return `data:image/jpeg;base64,${image.base64String}`;
  }
}
```

* In the **web** app you could replace the body with a file‑picker implementation if you want a fallback.
* In the **mobile** app you get the real camera.

Add the service to `SharedModule` (providedIn: 'root' works automatically).

### Other common plugins
| Feature | Capacitor Plugin | Web fallback idea |
|---------|------------------|-------------------|
| Geolocation | `@capacitor/geolocation` | HTML5 Geolocation API |
| Push Notifications | `@capacitor/push-notifications` | Use Web Push (service worker) or show a toast |
| File System | `@capacitor/filesystem` | Use IndexedDB via a library like `idb` |
| Storage | `@capacitor/storage` | `localStorage` (already works) |
| Splash Screen | `@capacitor/splash-screen` | Not needed on web; hide via CSS |

Keep the fallback logic inside the service so components stay agnostic.
## Styling & Theming

### Ionic’s CSS Variables
Ionic provides a set of CSS variables you can override in `apps/mobile/src/theme/variables.scss`.  
If you want the mobile app to share the **exact same look** as the web, you can simply import the web’s global stylesheet:

```scss
// apps/mobile/src/global.scss
@import '../web/src/styles.scss'; // assuming web styles are there
```

Alternatively, adopt Ionic’s theme and adjust your web stylesheet to use Ionic’s variables for consistency.

### Scoped Styles
When moving a component into a shared library, ensure its styles are encapsulated (`encapsulation: ViewEncapsulation.Emulated` – default). Avoid global selectors that might clash with Ionic’s base styles.

### Dark Mode
Both Angular (via `prefers-color-scheme`) and Ionic support dark mode. You can keep a single SCSS file that defines both light and dark variables and import it in both projects.

## Testing Strategy

| Test Type | Where it lives | Tools |
|-----------|----------------|-------|
| **Unit** (services, pipes, utils) | `libs/**/*.spec.ts` | Jest (Nx default) or Karma |
| **Component** (shared UI) | `libs/ui/**/*.spec.ts` | Jest + Angular Testing Library or TestBed |
| **End‑to‑End (Web)** | `apps/web/e2e/` | Cypress (Nx preset) |
| **End‑to‑End (Mobile)** | `apps/mobile/e2e/` (or reuse web e2e with Capacitor) | Cypress + Capacitor or Appium |
| **Lint** | All projects | ESLint + Prettier (Nx config) |

Run all tests with:
```bash
nx run-many --target=test --all
nx run-many --target=lint --all
```

### Mocking Capacitor in Tests
Because Capacitor plugins are not available in a plain Jest environment, either:
* Mock them in `jest.config.js`:
  ```js
  jest.mock('@capacitor/camera', () => ({
    Camera: {
      getPhoto: jest.fn().mockResolvedValue({ base64String: '' })
    }
  }));
  ```
* Or abstract them behind a service (as shown) and mock the service instead.
## CI/CD Pipeline (Example: GitHub Actions)

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x]
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - name: Run lint
        run: nx run-many --target=lint --all
      - name: Run unit tests
        run: nx run-many --target=test --all
      - name: Build web
        run: nx run web:build --configuration=production
      - name: Build mobile web assets
        run: |
          cd apps/mobile
          npm ci
          npm run build
      - name: Copy mobile assets for Capacitor
        run: |
          cd apps/mobile
          npx cap copy
      - (Optional) Upload Android/iOS artifacts as workflow artifacts
```

You can extend this to actually build the Android APK / IPA using `gradle` or `xcodebuild` inside the workflow, or use **Ionic Appflow** for automated store builds.
## Building & Releasing

### Web (unchanged)
```bash
nx run web:build --configuration=production
# Output: dist/apps/web
# Deploy to your existing host (Vercel, Netlify, Firebase, etc.)
```

### Mobile (Android)
```bash
# From repo root
cd apps/mobile
# Ensure Capacitor plugins are installed
npm i @capacitor/android   # if not already present
npx cap copy               # copies web assets to android/
npx cap open android       # opens Android Studio
# In Android Studio: Build > Build Bundle(s) / APK(s) > Build APK(s)
# The generated APK is under android/app/build/outputs/apk/debug/
```

### Mobile (iOS)
```bash
cd apps/mobile
npx cap open ios
# In Xcode: Product > Archive → Distribute App
```

**Versioning** – Keep a single `version` field in the workspace root `package.json` and bump it for both web and mobile releases. Capacitor reads `version` from `package.json` (or you can set it in `capacitor.config.json`).
## Estimated Effort (One Full‑Time Developer)

| Phase | Low (simple app) | Medium (typical e‑commerce) | High (large enterprise) |
|-------|------------------|-----------------------------|--------------------------|
| Shared code extraction | 1‑2 days | 3‑5 days | 1‑2 weeks |
| Ionic scaffold + Capacitor setup | 0.5‑1 day | 1 day | 1‑2 days |
| UI migration (component‑by‑component) | 1‑2 weeks | 2‑3 weeks | 3‑5 weeks |
| Platform‑specific services (camera, push, etc.) | 2‑3 days | 4‑5 days | 1‑2 weeks |
| Styling / theming adjustments | 2‑3 days | 1 week | 1‑2 weeks |
| Test suite adaptation (unit + e2e) | 3‑4 days | 1 week | 1‑2 weeks |
| CI/CD setup | 1‑2 days | 2‑3 days | 3‑5 days |
| Buffer for bug‑fixes, polishing, store preparation | 1 week | 1‑2 weeks | 2‑3 weeks |
| **Total** | **�≈3‑4 weeks** | **�≈5‑7 weeks** | **�≈8‑12 weeks** |

*If you have two developers (one focusing on services/shared code, the other on UI), calendar time can shrink roughly by 30‑40 %.*
## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Hidden browser‑only dependencies** (e.g., a library that uses `window` in a way Capacitor doesn’t support) | Runtime errors on device, missing features | Early audit: run `npm ls` and inspect each dependency; wrap risky libs behind a service with web fallback. |
| **UI looks out‑of‑place on mobile** (web‑centric design) | Poor user experience, higher bounce | Adopt Ionic’s theme for shared components; use native UI controls (ion-list, ion-card, ion-button) where appropriate. |
| **Increased bundle size** (duplicate Angular/core between web and mobile) | Larger download, slower startup | Use Nx’s build optimizations (`--prod`, `--build-optimizer`). Keep shared libraries as **single** versions; avoid bundling the same code twice. |
| **Capacitor plugin version conflicts** (Android/iOS) | Build failures | Lock plugin versions in `package.json`; test on both platforms regularly. |
| **State persistence differences** (localStorage vs. native storage) | Data loss when switching between web and mobile | Use a storage abstraction service that picks the best available (Capacitor Storage → localStorage). |
| **Team unfamiliar with Nx/Ionic** | Slower start | Spend 1‑2 days on a short tutorial; leverage Nx’s excellent docs and Ionic’s getting‑started guide. |
| **App Store review rejection** (missing privacy notices, etc.) | Release delay | Follow platform guidelines early; include required usage descriptions in `Info.plist` (iOS) and `AndroidManifest.xml`. |
## Checklist

- [ ] **Monorepo ready**: Nx workspace with `apps/web` (original) and `apps/mobile` (Ionic starter).
- [ ] **Shared library** (`@nizams/shared`) contains all services, models, guards, interceptors, utils, constants.
- [ ] **Web app** builds and runs unchanged after switching imports to the shared library.
- [ ] **Ionic + Capacitor** scaffold works (`npm run ionic:serve` and `npx cap open android/ios`).
- [ ] **Mobile app** consumes the shared library and can make API calls identical to the web.
- [ ] **UI components** migrated incrementally to a shared UI library or copied over, styled with Ionic where desired.
- [ ] **Platform‑specific features** abstracted behind services with appropriate web fallbacks.
- [ ] **Styling** unified (either using web globals or Ionic variables) and dark‑mode ready.
- [ ] **Test suite** passes for unit, lint, and web e2e; mobile e2e either runs or is mocked.
- [ ] **CI pipeline** builds, lints, tests, and packages both targets on every PR.
- [ ] **Release artifacts**: web production bundle, Android APK/AAB, iOS IPA.
- [ ] **Documentation** updated (README, onboarding guide) describing the monorepo structure and how to develop for both targets.
## References & Further Reading

- **Nx Documentation** – https://nx.dev
- **Ionic Framework + Angular** – https://ionicframework.com/docs/angular
- **Capacitor Documentation** – https://capacitorjs.com/docs
- **Angular Service Worker / PWA** – https://angular.io/guide/service-worker-intro
- **Monorepo Patterns** – https://blog.nrwl.io/monorepos-why-and-how-6f1b5c6c4c9c
- **Testing Capacitor Plugins with Jest** – https://capacitorjs.com/docs/unit-testing
- **GitHub Actions for Node.js** – https://docs.github.com/en/actions/automating-builds-and-tests/building-and-testing-nodejs-or-python
- **Ionic Appflow (Automated Store Builds)** – https://ionic.io/appflow



