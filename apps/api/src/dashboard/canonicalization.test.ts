import { describe, expect, it } from 'vitest';

import {
  DashboardCanonicalizationError,
  canonicalJsonUtf8,
  canonicalizeJson,
  hashCanonicalJson,
} from './canonicalization.js';
import { parseStrictJsonText } from './request-body.js';

describe('dashboard canonicalization', () => {
  it('sorts object keys by UTF-16 code units and preserves array order', () => {
    const value = {
      z: 1,
      a: [3, 2, 1],
      '\ue000': true,
      '𐀀': false,
    };
    expect(canonicalizeJson(value)).toBe('{"a":[3,2,1],"z":1,"𐀀":false,"":true}');
  });

  it('normalizes equivalent number values and rejects unsupported values', () => {
    expect(canonicalizeJson({ integer: 1, fraction: 0.1, exponent: 1e20 })).toBe(
      '{"exponent":100000000000000000000,"fraction":0.1,"integer":1}',
    );
    expect(() => canonicalizeJson(-0)).toThrowError(DashboardCanonicalizationError);
    expect(() => canonicalizeJson(Number.NaN)).toThrowError(DashboardCanonicalizationError);
    expect(() => canonicalizeJson(undefined)).toThrowError(DashboardCanonicalizationError);
  });

  it('escapes lone surrogates before UTF-8 encoding while preserving pairs and U+FFFD', () => {
    const value = {
      a: '\ud800',
      b: '\udc00',
      pair: '😀',
      replacement: '�',
    };
    const canonical = canonicalizeJson(value);
    expect(canonical).toBe('{"a":"\\ud800","b":"\\udc00","pair":"😀","replacement":"�"}');
    expect(new TextDecoder().decode(canonicalJsonUtf8(value))).toBe(canonical);
    expect(hashCanonicalJson(value)).toBe(
      '5ae4e1e0445664c852a9ea1e41c88b3359038a2a0074b30dc2df7f99174d1bea',
    );
    expect(hashCanonicalJson({ a: '�' })).not.toBe(hashCanonicalJson({ a: '\ud800' }));
  });

  it('handles prototype-named dictionary keys as ordinary own properties', () => {
    const value = Object.create(null) as { __proto__: string; a: number };
    Object.defineProperty(value, '__proto__', {
      value: 'value',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    value.a = 1;
    expect(canonicalizeJson(value)).toBe('{"__proto__":"value","a":1}');
    expect(hashCanonicalJson(value)).toBe(
      'b3086e08da90fdb84fe0b601986435a8d4346f24449705e1980826b8ea058d3c',
    );
  });
  it('preserves lone surrogate keys distinctly from replacement characters and equivalent escapes', () => {
    const value = Object.fromEntries([
      ['\ud800', 'high'],
      ['\udc00', 'low'],
      ['😀', 'pair'],
      ['�', 'replacement'],
    ]);
    const canonical = '{"\\ud800":"high","😀":"pair","\\udc00":"low","�":"replacement"}';
    expect(canonicalizeJson(value)).toBe(canonical);
    expect(canonicalJsonUtf8(value)).toEqual(new TextEncoder().encode(canonical));
    const escaped = parseStrictJsonText(
      '{"\\uFFFD":"replacement","\\uDC00":"low","\\uD83D\\uDE00":"pair","\\uD800":"high"}',
    );
    expect(hashCanonicalJson(escaped)).toBe(hashCanonicalJson(value));
    for (const key of ['\ud800', '\udc00']) {
      expect(canonicalJsonUtf8({ [key]: 'x' })).not.toEqual(canonicalJsonUtf8({ '�': 'x' }));
      expect(hashCanonicalJson({ [key]: 'x' })).not.toBe(hashCanonicalJson({ '�': 'x' }));
    }
  });
});
