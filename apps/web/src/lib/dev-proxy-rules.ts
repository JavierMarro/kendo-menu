import type { ProxyOptions } from 'vite';
import type { IncomingMessage } from 'node:http';

export function createDevelopmentProxyRules(
  proofRequestAllowed: (request: IncomingMessage) => boolean,
): Record<string, ProxyOptions> {
  return {
    '^/api/(?:account|dashboard(?:/adoption)?)(?:\\?.*)?$': {
      target: 'http://127.0.0.1:3000',
      changeOrigin: false,
    },
    '^/api/dev/managed-identity(?:\\?.*)?$': {
      target: 'http://127.0.0.1:3001',
      changeOrigin: false,
      bypass: (request) => (proofRequestAllowed(request) ? undefined : false),
    },
  };
}
