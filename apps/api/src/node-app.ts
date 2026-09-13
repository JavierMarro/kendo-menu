import { node } from '@elysia/node';
import { Elysia } from 'elysia';
import { WebStandardAdapter } from 'elysia/adapter/web-standard';

import { createApp, type AppOptions } from './app.js';

/** Node transport composition is importable without binding a listener. */
export function createNodeApp(options: AppOptions = {}) {
  // @elysia/node 1.4.6 converts Response headers through Object.fromEntries,
  // which drops repeated Set-Cookie fields. Retain its Node listener while
  // using Elysia's standard Response mapping to preserve every cookie.
  return new Elysia({ adapter: { ...node(), handler: WebStandardAdapter.handler } }).use(
    createApp(options),
  );
}
