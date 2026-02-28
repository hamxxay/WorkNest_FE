// ============================================================
// Development Environment Configuration
// ============================================================
// This file defines environment-specific variables for development.
// These are the settings used during local development (ng serve).
//
// For production builds, use environment.prod.ts instead.

export const environment = {
  // Set to false for development, true for production
  production: false,
  
  // Base URL for all API requests
  // Points to local backend development server running on port 5000
  // When using npm start with a proxy, credentials are forwarded by
  // the interceptor and the proxy will relay the Set-Cookie header.
  apiUrl: 'http://localhost:5000/api'
};
