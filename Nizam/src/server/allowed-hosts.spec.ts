import { buildAllowedHosts, buildAllowedOrigins, NATIVE_APP_ORIGINS } from './allowed-hosts';

describe('buildAllowedHosts', () => {
  // Regression: production was fully down with
  //   Header "host" with value "api.ammawears.com" is not allowed.
  // because the allow-list was a hardcoded localhost/Codespaces array.
  it('derives the api. subdomain from the deployed origin', () => {
    const hosts = buildAllowedHosts({ APP_URL: 'https://ammawears.com' });
    expect(hosts).toContain('api.ammawears.com');
  });

  it('derives www. and the api. subdomain from a bare hostname', () => {
    const hosts = buildAllowedHosts({ CORS_ORIGIN: 'ammawears.com' });
    expect(hosts).toEqual(expect.arrayContaining(['ammawears.com', 'www.ammawears.com', 'api.ammawears.com']));
  });

  it('covers every Render service name via the wildcard', () => {
    expect(buildAllowedHosts({})).toContain('*.onrender.com');
  });

  it('adds www./api. for an explicit api. origin without nesting them', () => {
    const hosts = buildAllowedHosts({ API_URL: 'https://api.ammawears.com' });
    expect(hosts).toContain('api.ammawears.com');
    expect(hosts).not.toContain('api.www.ammawears.com');
  });

  it('does not nest api. under a www. origin', () => {
    const hosts = buildAllowedHosts({ CORS_ORIGIN: 'https://www.ammawears.com' });
    expect(hosts).not.toContain('api.www.ammawears.com');
  });

  // The check compares URL.hostname, which never carries a port, so listing one
  // matches nothing at all.
  it('drops ports, which the Host comparison would never match', () => {
    expect(buildAllowedHosts({ APP_URL: 'http://localhost:4200' })).not.toContain('localhost:4200');
  });

  it('accepts a comma-separated list and ignores blanks', () => {
    const hosts = buildAllowedHosts({ CORS_ORIGIN: 'https://a.com, ,https://b.com' });
    expect(hosts).toContain('a.com');
    expect(hosts).toContain('b.com');
  });

  it('honours an explicit escape hatch for new domains', () => {
    const hosts = buildAllowedHosts({ EXTRA_ALLOWED_HOSTS: 'new-domain.com' });
    expect(hosts).toContain('new-domain.com');
  });

  it('skips unparseable entries instead of throwing', () => {
    expect(() => buildAllowedHosts({ APP_URL: 'http://' })).not.toThrow();
  });

  // Without the api. entry the storefront answers 400 on its own API host.
  it('never produces an empty list', () => {
    expect(buildAllowedHosts({}).length).toBeGreaterThan(0);
  });
});

describe('buildAllowedOrigins', () => {
  // The Capacitor WebView sends capacitor://localhost on iOS and
  // http://localhost on Android. Losing these in production breaks every API
  // call from the shipped app at the preflight.
  it.each(NATIVE_APP_ORIGINS)('allows the native origin %s in production', origin => {
    const origins = buildAllowedOrigins({
      CORS_ORIGIN: 'https://ammawears.com',
      NODE_ENV: 'production'
    });
    expect(origins).toContain(origin);
  });

  it('keeps the web storefront origins in production', () => {
    const origins = buildAllowedOrigins({
      CORS_ORIGIN: 'https://ammawears.com,https://www.ammawears.com',
      NODE_ENV: 'production'
    });
    expect(origins).toContain('https://ammawears.com');
    expect(origins).toContain('https://www.ammawears.com');
  });

  it('adds the dev servers only outside production', () => {
    const dev = buildAllowedOrigins({ CORS_ORIGIN: 'https://ammawears.com' });
    expect(dev).toContain('http://localhost:4200');

    const prod = buildAllowedOrigins({
      CORS_ORIGIN: 'https://ammawears.com',
      NODE_ENV: 'production'
    });
    expect(prod).not.toContain('http://localhost:4200');
  });

  it('does not duplicate an origin already listed in CORS_ORIGIN', () => {
    const origins = buildAllowedOrigins({ CORS_ORIGIN: 'https://a.com,http://localhost' });
    expect(origins.filter(o => o === 'http://localhost')).toHaveLength(1);
  });
});
