/**
 * Public API-package surface for transport adapters and tests.
 * Factories are exported instead of a live application so importing the package never binds a
 * listener, reads credentials, or opens a database connection.
 */
export { createApp } from './app.js';
export type { App } from './app.js';
export { createAccount } from './account/account.js';
export type { Account } from './account/account.js';
export { createAdoption } from './adoption/adoption.js';
export type { Adoption } from './adoption/adoption.js';
export { createRuntimeServices } from './runtime.js';
