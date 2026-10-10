import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { expect, it, vi } from 'vitest';

import { createDevelopmentProxyRules } from './dev-proxy-rules';

it('keeps account API proxying exact and preserves the browser Origin header', () => {
  const rules = createDevelopmentProxyRules(() => true);
  const account = rules['^/api/(?:account|dashboard)(?:\\?.*)?$'];
  expect(account).toMatchObject({ target: 'http://127.0.0.1:3000', changeOrigin: false });
  expect(Object.keys(rules)).toEqual([
    '^/api/(?:account|dashboard)(?:\\?.*)?$',
    '^/api/dev/managed-identity(?:\\?.*)?$',
  ]);
});

it('keeps the proof identity proxy separate and applies its loopback guard', () => {
  const allowRequest = vi.fn((request: IncomingMessage) => request.url === '/allowed');
  const proof = createDevelopmentProxyRules(allowRequest)['^/api/dev/managed-identity(?:\\?.*)?$'];
  expect(proof).toMatchObject({ target: 'http://127.0.0.1:3001', changeOrigin: false });
  const bypass = proof?.bypass;
  expect(bypass).toBeDefined();
  const allowed = new IncomingMessage(new Socket());
  allowed.url = '/allowed';
  const denied = new IncomingMessage(new Socket());
  denied.url = '/denied';
  expect(bypass?.(allowed, new ServerResponse(allowed), proof ?? {})).toBeUndefined();
  expect(bypass?.(denied, new ServerResponse(denied), proof ?? {})).toBe(false);
  expect(allowRequest).toHaveBeenCalledTimes(2);
});
