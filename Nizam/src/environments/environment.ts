// Development environment configuration
export const environment = {
  production: false,
  appName: 'Nizam.ai',
  // GA4 measurement id — swap for the live "G-XXXXXXX" id to enable analytics.
  gaMeasurementId: 'G-RSLG311ES9',
  // Use relative URLs in development so it works with Codespaces preview URLs
  // The SSR server serves both frontend and API on the same origin
  apiUrl: (typeof window !== 'undefined' && window.location.origin.includes('localhost'))
    ? 'http://localhost:4000'
    : '',
};