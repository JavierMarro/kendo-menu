import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_REQUEST_ERROR_CODES,
  DashboardRequestError,
  MAX_JSON_LEXICAL_DEPTH,
  checkDashboardRequestHeaders,
  parseStrictJsonBytes,
  parseStrictJsonText,
  readDashboardRequestBody,
} from './request-body.js';
import { MAX_DASHBOARD_REQUEST_BYTES } from './contracts.js';

const URL = 'https://app.example.test/api/dashboard';
const JSON_HEADERS = { 'content-type': 'application/json' };

function requestWithBody(body: BodyInit | null, headers: HeadersInit = JSON_HEADERS): Request {
  return new Request(URL, {
    method: 'PUT',
    headers,
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
  });
}

function expectRequestError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected a dashboard request error.');
  } catch (error) {
    expect(error).toBeInstanceOf(DashboardRequestError);
    if (error instanceof DashboardRequestError) {
      expect(error.code).toBe(code);
      expect(error.status).toBeGreaterThan(0);
    }
  }
}

async function expectAsyncRequestError(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
    throw new Error('Expected a dashboard request error.');
  } catch (error) {
    expect(error).toBeInstanceOf(DashboardRequestError);
    if (error instanceof DashboardRequestError) {
      expect(error.code).toBe(code);
      expect(error.status).toBeGreaterThan(0);
    }
  }
}

function streamFromChunks(
  chunks: readonly Uint8Array[],
  onCancel?: () => void | PromiseLike<void>,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      onCancel?.();
    },
  });
}

function multibyteJsonBytes(targetBytes: number): {
  readonly bytes: Uint8Array;
  readonly split: number;
} {
  const encoder = new TextEncoder();
  const prefix = '{"value":"';
  const suffix = '"}';
  const asciiCount =
    targetBytes - encoder.encode(prefix).byteLength - 2 - encoder.encode(suffix).byteLength;
  if (asciiCount < 0) {
    throw new Error('The requested test body is too small for its fixture.');
  }
  const bytes = encoder.encode(`${prefix}${'a'.repeat(asciiCount)}é${suffix}`);
  const firstMultibyteByte = bytes.indexOf(0xc3);
  if (firstMultibyteByte < 0) {
    throw new Error('Expected a multibyte fixture.');
  }
  return { bytes, split: firstMultibyteByte + 1 };
}

describe('dashboard request header preflight', () => {
  it('accepts JSON with no charset or one UTF-8 charset', () => {
    expect(checkDashboardRequestHeaders(requestWithBody(null))).toBeNull();
    expect(
      checkDashboardRequestHeaders(
        requestWithBody(null, { 'content-type': 'Application/JSON; charset="UTF-8"' }),
      ),
    ).toBeNull();
  });

  it('rejects other media types and parameters', () => {
    for (const contentType of [
      'text/plain',
      'application/json; charset=latin-1',
      'application/json; profile=dashboard',
      'application/json; charset=utf-8; profile=dashboard',
      'application/json; charset=',
    ]) {
      expect(
        checkDashboardRequestHeaders(requestWithBody(null, { 'content-type': contentType })),
      ).toBe(DASHBOARD_REQUEST_ERROR_CODES.unsupportedMediaType);
    }
  });

  it('accepts identity and rejects all other content encodings', () => {
    expect(
      checkDashboardRequestHeaders(
        requestWithBody(null, { ...JSON_HEADERS, 'content-encoding': 'identity' }),
      ),
    ).toBeNull();
    expect(
      checkDashboardRequestHeaders(
        requestWithBody(null, { ...JSON_HEADERS, 'content-encoding': 'gzip' }),
      ),
    ).toBe(DASHBOARD_REQUEST_ERROR_CODES.unsupportedContentEncoding);
  });

  it('rejects malformed lengths and rejects an early valid oversized length', () => {
    expect(
      checkDashboardRequestHeaders(
        requestWithBody(null, { ...JSON_HEADERS, 'content-length': '1,2' }),
      ),
    ).toBe(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    expect(
      checkDashboardRequestHeaders(
        requestWithBody(null, { ...JSON_HEADERS, 'content-length': '002097152' }),
      ),
    ).toBeNull();
    expect(
      checkDashboardRequestHeaders(
        requestWithBody(null, { ...JSON_HEADERS, 'content-length': '2097153' }),
      ),
    ).toBe(DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge);
  });

  it('does not touch the body stream during preflight', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode('{}'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const request = requestWithBody(body);
    expect(checkDashboardRequestHeaders(request)).toBeNull();
    await Promise.resolve();
    expect(pulls).toBe(0);
  });
});

describe('strict dashboard JSON body handling', () => {
  it('parses valid JSON after a chunk-split UTF-8 sequence', async () => {
    const bytes = new TextEncoder().encode('{"name":"é"}');
    const split = bytes.indexOf(0xc3) + 1;
    const request = requestWithBody(streamFromChunks([bytes.slice(0, split), bytes.slice(split)]));
    await expect(readDashboardRequestBody(request)).resolves.toEqual({ name: 'é' });
  });

  it('rejects malformed UTF-8, a BOM, and malformed JSON', () => {
    expectRequestError(
      () => parseStrictJsonBytes(Uint8Array.from([0xc3, 0x28])),
      DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
    );
    expectRequestError(
      () => parseStrictJsonBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
      DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
    );
    expectRequestError(
      () => parseStrictJsonText('{"name":'),
      DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
    );
    for (const source of ['-x1', '- 1', '01', '1.', '1e', '1e+', '+1', '[1true]']) {
      expectRequestError(
        () => parseStrictJsonText(source),
        DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
      );
    }
  });

  it('rejects duplicate decoded keys, including escaped spellings', () => {
    for (const source of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"\\uD800":1,"\\ud800":2}']) {
      expectRequestError(
        () => parseStrictJsonText(source),
        DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
      );
    }
  });

  it('rejects negative zero and numbers whose JSON.parse value is lossy', () => {
    for (const source of [
      '-0',
      '-0.0',
      '-0e10',
      '9007199254740993',
      '1000000000000000100',
      '0.10000000000000001',
      '1e-324',
      '1e309',
      '1e23',
    ]) {
      expectRequestError(
        () => parseStrictJsonText(source),
        DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
      );
    }
    expect(parseStrictJsonText('0.1')).toBe(0.1);
    expect(parseStrictJsonText('1.0e0')).toBe(1);
    expect(parseStrictJsonText('9007199254740992')).toBe(9_007_199_254_740_992);
    expect(parseStrictJsonText('1e21')).toBe(1e21);
  });

  it('handles a zero mantissa with a very large exponent without unbounded numeric work', () => {
    expect(parseStrictJsonText(`0e${'9'.repeat(20_000)}`)).toBe(0);
    expect(parseStrictJsonText(`1e${'0'.repeat(20_000)}1`)).toBe(10);
    expect(parseStrictJsonText(`${'1'}${'0'.repeat(1_000_000)}e-1000000`)).toBe(1);
    expectRequestError(
      () => parseStrictJsonText(`1e${'9'.repeat(20_000)}`),
      DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
    );
    expectRequestError(
      () => parseStrictJsonText(`1${'0'.repeat(20_000)}`),
      DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
    );
  });

  it('rejects a JSON container nesting depth above the lexical bound', () => {
    const allowed = `${'['.repeat(MAX_JSON_LEXICAL_DEPTH)}0${']'.repeat(MAX_JSON_LEXICAL_DEPTH)}`;
    expect(parseStrictJsonText(allowed)).toEqual(JSON.parse(allowed));
    const tooDeep = `${'['.repeat(MAX_JSON_LEXICAL_DEPTH + 1)}0${']'.repeat(MAX_JSON_LEXICAL_DEPTH + 1)}`;
    expectRequestError(
      () => parseStrictJsonText(tooDeep),
      DASHBOARD_REQUEST_ERROR_CODES.invalidRequest,
    );
  });

  it('counts received bytes rather than trusting Content-Length and cancels on the first excess chunk', async () => {
    let cancelled = false;
    const under = new TextEncoder().encode(`{"x":1}${' '.repeat(2_097_152 - 7)}`);
    expect(under.byteLength).toBe(2_097_152);
    await expect(
      readDashboardRequestBody(requestWithBody(streamFromChunks([under]))),
    ).resolves.toEqual({ x: 1 });

    const over = new Uint8Array(2_097_153);
    over.fill(0x20);
    await expectAsyncRequestError(
      () =>
        readDashboardRequestBody(
          requestWithBody(
            streamFromChunks([over], () => {
              cancelled = true;
            }),
          ),
        ),
      DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge,
    );
    expect(cancelled).toBe(true);

    const misleadingLength = requestWithBody(streamFromChunks([over]), {
      ...JSON_HEADERS,
      'content-length': '1',
    });
    await expectAsyncRequestError(
      () => readDashboardRequestBody(misleadingLength),
      DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge,
    );
  });

  it('accepts valid UTF-8 bodies immediately below and at the byte limit, then rejects the next byte', async () => {
    for (const targetBytes of [MAX_DASHBOARD_REQUEST_BYTES - 1, MAX_DASHBOARD_REQUEST_BYTES]) {
      const fixture = multibyteJsonBytes(targetBytes);
      expect(fixture.bytes.byteLength).toBe(targetBytes);
      const parsed = await readDashboardRequestBody(
        requestWithBody(
          streamFromChunks([
            fixture.bytes.slice(0, fixture.split),
            fixture.bytes.slice(fixture.split),
          ]),
        ),
      );
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Expected a parsed object.');
      }
      expect(Object.getOwnPropertyDescriptor(parsed, 'value')?.value).toEqual(expect.any(String));
    }

    const over = multibyteJsonBytes(MAX_DASHBOARD_REQUEST_BYTES + 1);
    expect(over.bytes.byteLength).toBe(MAX_DASHBOARD_REQUEST_BYTES + 1);
    await expectAsyncRequestError(
      () =>
        readDashboardRequestBody(
          requestWithBody(
            streamFromChunks([over.bytes.slice(0, over.split), over.bytes.slice(over.split)]),
          ),
        ),
      DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge,
    );
    await expectAsyncRequestError(
      () =>
        readDashboardRequestBody(
          requestWithBody(streamFromChunks([over.bytes]), {
            ...JSON_HEADERS,
            'content-length': '1',
          }),
        ),
      DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge,
    );
  });

  it('returns 413 even when stream cancellation rejects or never settles', async () => {
    const over = new Uint8Array(MAX_DASHBOARD_REQUEST_BYTES + 1);
    over.fill(0x20);
    const rejectingCancel = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(over);
        },
        cancel() {
          throw new Error('cancel failed');
        },
      },
      { highWaterMark: 0 },
    );
    await expectAsyncRequestError(
      () => readDashboardRequestBody(requestWithBody(rejectingCancel)),
      DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge,
    );

    const hangingCancel = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(over);
        },
        cancel() {
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const outcome = await Promise.race([
      readDashboardRequestBody(requestWithBody(hangingCancel)).then(
        () => ({ status: 'resolved' as const }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      ),
      new Promise<{ readonly status: 'timed-out' }>((resolve) => {
        setTimeout(() => resolve({ status: 'timed-out' }), 250);
      }),
    ]);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.error).toBeInstanceOf(DashboardRequestError);
      if (outcome.error instanceof DashboardRequestError) {
        expect(outcome.error.code).toBe(DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge);
      }
    }
  });

  it('copies each received chunk before a producer can reuse its buffer', async () => {
    const shared = new Uint8Array(2);
    let step = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (step === 0) {
            shared.set([0x7b, 0x22]);
            controller.enqueue(shared);
            step += 1;
            return;
          }
          if (step === 1) {
            shared.set([0x78, 0x22]);
            controller.enqueue(shared);
            step += 1;
            return;
          }
          if (step === 2) {
            shared.set([0x3a, 0x31]);
            controller.enqueue(shared);
            step += 1;
            return;
          }
          shared.set([0x7d, 0x20]);
          controller.enqueue(shared.subarray(0, 1));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    await expect(readDashboardRequestBody(requestWithBody(body))).resolves.toEqual({ x: 1 });
  });

  it('maps unsupported headers before acquiring the stream reader', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode('{}'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    await expectAsyncRequestError(
      () => readDashboardRequestBody(requestWithBody(body, { 'content-type': 'text/plain' })),
      DASHBOARD_REQUEST_ERROR_CODES.unsupportedMediaType,
    );
    await Promise.resolve();
    expect(pulls).toBe(0);
  });
});
