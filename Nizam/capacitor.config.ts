import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Amma Wears mobile app.
 *
 * `webDir` points at `www/browser`, the output of the `build-mobile` Angular
 * target — a pure client bundle. It is NOT the website's `dist/Nizam`, which is
 * an SSR output (an Express server plus a browser subfolder) and cannot boot
 * inside a WebView.
 *
 * The `browser` suffix is not a typo: Angular's `application` builder always
 * nests browser output in a `browser/` subfolder of `outputPath`, so
 * `outputPath: "www"` produces `www/browser`.
 */
/**
 * Points the WebView at a dev server for hot reload, when one is requested.
 *
 * `npm run live:android` / `live:ios` set CAP_SERVER_HOST to the LAN address of
 * the machine running `ng serve`. With it unset -- the normal case -- the app
 * loads the bundled assets from disk exactly as it will in the store.
 *
 * The host is read from the environment rather than hardcoded deliberately: a
 * stale IP left in this file would silently point every shipped user at a dead
 * dev server, and the app would fail to start with no obvious cause.
 *
 * `cleartext` is required because the dev server is plain HTTP. It is only ever
 * reachable on the local network during development.
 */
function liveReloadServer(): CapacitorConfig['server'] {
  const host = process.env['CAP_SERVER_HOST'];

  if (!host) {
    // https, not http: on Android the bundled assets are served over https, and
    // a plain-http WebView would trip the cleartext-traffic block.
    return { androidScheme: 'https' };
  }

  return {
    androidScheme: 'http',
    url: `http://${host}:4200`,
    cleartext: true,
  };
}

const config: CapacitorConfig = {
  appId: 'com.ammawears.app',
  appName: 'Amma Wears',
  webDir: 'www/browser',

  // The Android package name and iOS bundle identifier are derived from appId.
  // appId must never change once the apps are published: the store listings,
  // signing keys and install base are all tied to it. A change means shipping
  // an entirely new app.

  plugins: {
    SplashScreen: {
      // Capacitor dismisses the branded splash itself once the WebView has
      // painted, fading out over 400ms. Doing it manually from app code was
      // removed: a hide() call in the root constructor fires before the first
      // route has rendered, which is exactly the white flash auto-hide exists
      // to prevent. The frames in between stay brand-navy because <html> is
      // painted that colour in styles.mobile.css.
      launchAutoHide: true,
      launchFadeOutDuration: 400,
      backgroundColor: '#14263D',
      androidSplashResourceName: 'splash',
      showSpinner: true,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      // Matched to the app's navy header; the WebView draws beneath it.
      style: 'LIGHT',
      backgroundColor: '#14263D',
      overlaysWebView: true,
    },
    Keyboard: {
      // Shrink the WebView rather than pan it, so the whole form stays visible
      // above the software keyboard while typing.
      resize: 'native',
      resizeOnFullScreen: true,
    },
    android: {
      // WebView debuggability is tied to the build variant, not this flag; this
      // keeps Chrome DevTools usable against a debug install.
      allowMixedContent: false,
    },
  },

  server: liveReloadServer(),
};

export default config;