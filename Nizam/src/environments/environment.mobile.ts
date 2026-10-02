// Mobile (Capacitor / Ionic) environment configuration.
//
// The mobile bundle runs inside a native WebView whose origin is
// `capacitor://localhost` on iOS and `http://localhost` on Android. Relative
// `/api/...` URLs — which every shared service uses on the SSR site — would
// resolve against that WebView origin and 404, so the mobile build needs an
// absolute API origin.
//
// `apiUrl` is prepended by MobileApiInterceptor, which rewrites relative API
// requests. That keeps the shared services (cart, wishlist, auth, catalog)
// completely unchanged between the website and the app.
//
// Before shipping to the stores, make sure this origin is allowed natively:
//   - Express: an origin in the CORS allow-list (see src/server.ts)
//   - iOS: ATS is satisfied by any HTTPS origin, so no exception is needed
//   - Android: cleartext HTTP is blocked by default, so HTTPS is required
export const environment = {
  production: true,
  appName: 'Amma Wears',
  // GA4 measurement id — replace with the live "G-XXXXXXX" id before launch.
  gaMeasurementId: 'G-X8Q0VPPQ0K',
  // Absolute origin of the deployed API. No trailing slash.
  apiUrl: 'https://api.ammawears.com',
};