import { createNodeApp } from './node-app.js';
import { createManagedIdentityVerifier } from './auth/managed-identity.js';

createNodeApp({
  managedIdentity: createManagedIdentityVerifier(process.env['NEON_AUTH_BASE_URL']),
}).listen({ hostname: '127.0.0.1', port: 3001 });
