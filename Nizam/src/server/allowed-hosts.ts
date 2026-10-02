/**
 * Host-header allow-list and CORS origins for the SSR server.
 *
 * Kept in its own module, separate from `server.ts`, purely so it can be unit
 * tested: importing `server.ts` starts listening and connects to MongoDB, which
 * makes it untestable. Both functions below are pure apart from reading
 * `process.env`.
 */

/** Origins the Capacitor WebView sends on every API request. */
export const NATIVE_APP_ORIGINS = [
  'capacitor://localhost',
  'http://localhost',
  'https://localhost'
];

/**
 * Hostnames the SSR engine will accept in the `Host` header.
 *
 * Angular validates that header against `security.allowedHosts` /
 * `NG_ALLOWED_HOSTS` to mitigate SSRF, and answers 400 for anything else. The
 * set therefore has to include whatever hostname the site is actually served
 * on, which is only known at runtime:
 *
 *  - loopback names, for local and Codespaces runs;
 *  - `*.onrender.com`, because Render always serves the service from
 *    `<service-name>.onrender.com`. A wildcard is used rather than the literal
 *    host so that renaming the service (or a stale APP_URL left over from a
 *    previous name) cannot take the whole site down with a 400 again -- that is
 *    exactly what happened with `nizam-ai-zpwn.onrender.com`;
 *  - the Codespaces forwarded-preview domain;
 *  - the deployed origins from `APP_URL`, `CORS_ORIGIN`, `API_URL` and
 *    `RENDER_EXTERNAL_URL`, which also covers a custom domain;
 *  - an explicit `EXTRA_ALLOWED_HOSTS` list for anything else.
 *
 * Ports are dropped because the check compares against `URL.hostname`, which
 * never contains one -- listing `localhost:4200` matches nothing.
 */
export function buildAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts = new Set<string>([
    'localhost',
    '127.0.0.1',
    '[::1]',
    '*.app.github.dev',
    // Render serves every web service from <service>.onrender.com.
    '*.onrender.com'
  ]);

  const addFromUrl = (value: string | undefined): void => {
    if (!value) {
      return;
    }
    // CORS_ORIGIN may be a comma-separated list; APP_URL should be a single URL.
    for (const entry of value.split(',')) {
      const candidate = entry.trim();
      if (!candidate) {
        continue;
      }
      try {
        // Bare hostnames ("ammawears.com") are not parseable as a URL, so prefix
        // them with a scheme purely to read the hostname back out.
        const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
          ? candidate
          : `https://${candidate}`;
        const { hostname } = new URL(withScheme);
        if (hostname) {
          hosts.add(hostname);
          // Accept the `www` variant too, since both are commonly pointed at the
          // same Render service. Skipped for loopback and IP literals, where a
          // `www.` prefix is meaningless.
          const isLiteralHost =
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname.endsWith('.local') ||
            /^\[.*\]$/.test(hostname) ||
            /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
          if (!isLiteralHost) {
            if (hostname.startsWith('www.')) {
              hosts.add(hostname.slice(4));
            } else if (!hostname.startsWith('api.')) {
              hosts.add(`www.${hostname}`);
            }
            // The storefront is also served from an `api.` subdomain
            // (`environment.prod.ts` -> apiUrl `https://api.<domain>`), which is
            // a separate hostname and therefore a separate Host header. Without
            // this, requests to the API host were rejected with
            // `Header "host" with value "api.<domain>" is not allowed.`
            // Only derived from the bare domain, so this cannot produce
            // nonsense entries such as `api.www.example.com`.
            if (!hostname.startsWith('api.') && !hostname.startsWith('www.')) {
              hosts.add(`api.${hostname}`);
            }
          }
        }
      } catch {
        // Not a URL we can parse; nothing to add.
      }
    }
  };

  addFromUrl(env['APP_URL']);
  addFromUrl(env['CORS_ORIGIN']);
  addFromUrl(env['API_URL']);
  addFromUrl(env['RENDER_EXTERNAL_URL']);

  // Render also exposes the bare hostname without a scheme.
  if (env['RENDER_EXTERNAL_HOSTNAME']) {
    hosts.add(env['RENDER_EXTERNAL_HOSTNAME'].trim());
  }

  // Explicit escape hatch for any host the conventions above do not cover,
  // so a new domain never requires a code change to be reachable.
  addFromUrl(env['EXTRA_ALLOWED_HOSTS']);

  return [...hosts].filter(Boolean);
}

/**
 * Origins permitted to call the API with credentials.
 *
 * The native app origins are always included, including in production: the
 * Capacitor WebView reports `capacitor://localhost` (iOS) or `http://localhost`
 * (Android), and dropping them makes every preflight from the shipped app fail.
 */
export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const corsOrigin = env['CORS_ORIGIN'] || 'http://localhost:4200';
  const allowedOrigins = corsOrigin.split(',').map(o => o.trim());

  if (env['NODE_ENV'] !== 'production') {
    allowedOrigins.push(
      'http://localhost:4000',
      'http://localhost:4200',
      'http://127.0.0.1:4000',
      'http://127.0.0.1:4200'
    );
  }

  for (const origin of NATIVE_APP_ORIGINS) {
    if (!allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin);
    }
  }

  return allowedOrigins;
}
