import type { createNodeApp } from './node-app.js';

export async function withNodeListener<T>(
  app: ReturnType<typeof createNodeApp>,
  operation: (baseUrl: string) => Promise<T>,
): Promise<T> {
  let listener: unknown;
  app.listen({ hostname: '127.0.0.1', port: 0 }, (server) => {
    listener = server;
  });
  if (typeof listener !== 'object' || listener === null)
    throw new Error('TEST_LISTENER_UNAVAILABLE');
  const raw: unknown = Reflect.get(listener, 'raw');
  if (typeof raw !== 'object' || raw === null) throw new Error('TEST_RAW_LISTENER_UNAVAILABLE');
  const ready: unknown = Reflect.get(raw, 'ready');
  const close: unknown = Reflect.get(raw, 'close');
  if (typeof ready !== 'function' || typeof close !== 'function')
    throw new Error('TEST_LISTENER_LIFECYCLE_UNAVAILABLE');
  try {
    // The adapter callback runs before the socket binds; srvx.ready waits for listening/errors.
    await Reflect.apply(ready, raw, []);
    const url: unknown = Reflect.get(raw, 'url');
    if (typeof url !== 'string') throw new Error('TEST_LISTENER_URL_UNAVAILABLE');
    return await operation(new URL(url).origin);
  } finally {
    await Reflect.apply(close, raw, [true]);
  }
}
