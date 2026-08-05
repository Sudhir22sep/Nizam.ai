// Development environment configuration
export const environment = {
  production: false,
  // Use relative URLs in development so it works with Codespaces preview URLs
  // The SSR server serves both frontend and API on the same origin
  apiUrl: (typeof window !== 'undefined' && window.location.origin.includes('localhost'))
    ? 'http://localhost:4000'
    : '',
};