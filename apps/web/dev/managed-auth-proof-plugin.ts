/**
 * Serves the isolated managed-auth proof document from Vite's development server.
 * Loopback checks isolate proof access; the dispatcher keeps both callback flows on fixed paths.
 */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';

import type { Plugin } from 'vite';

const proofPath = '/managed-auth-proof.html';

export function isLoopbackProofRequest(request: IncomingMessage): boolean {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
}

/** Separate development document, absent from the production build and preview. */
export function managedAuthProofPlugin(): Plugin {
  return {
    name: 'managed-auth-proof',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestedUrl = new URL(request.url ?? '/', 'http://localhost');
        // The managed live callback can land at the origin root despite callbackURL.
        // Handle only this Neon-marked development return before the production SPA.
        const rootCallback =
          requestedUrl.pathname === '/' &&
          requestedUrl.searchParams.has('neon_auth_session_verifier');
        if (requestedUrl.pathname !== proofPath && !rootCallback) return next();
        if (!isLoopbackProofRequest(request)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        // The browser's credential-free per-tab marker chooses proof or application.
        // Let the normal entry dispatcher inspect it before either flow is imported.
        if (rootCallback) {
          next();
          return;
        }
        void (async () => {
          const source = await readFile(
            new URL('./managed-auth-proof.html', import.meta.url),
            'utf8',
          );
          const html = await server.transformIndexHtml(proofPath, source);
          response.setHeader('Content-Type', 'text/html');
          response.setHeader('Cache-Control', 'private, no-store');
          response.setHeader('Referrer-Policy', 'no-referrer');
          response.end(html);
        })().catch(() => {
          response.statusCode = 503;
          response.end('Proof page unavailable');
        });
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== proofPath) return next();
        response.statusCode = 404;
        response.end();
      });
    },
  };
}
