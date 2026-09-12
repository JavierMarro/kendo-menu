import { createHash } from 'node:crypto';

/** Error raised when a value cannot be represented as strict JSON. */
export class DashboardCanonicalizationError extends Error {
  constructor() {
    super('Dashboard value cannot be canonicalized.');
    this.name = 'DashboardCanonicalizationError';
  }
}

function canonicalizationError(): DashboardCanonicalizationError {
  return new DashboardCanonicalizationError();
}

function isPlainObject(value: object): boolean {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function escapeControlCharacter(codeUnit: number): string {
  switch (codeUnit) {
    case 0x08:
      return '\\b';
    case 0x09:
      return '\\t';
    case 0x0a:
      return '\\n';
    case 0x0c:
      return '\\f';
    case 0x0d:
      return '\\r';
    default:
      return `\\u${codeUnit.toString(16).padStart(4, '0')}`;
  }
}

/** JSON string encoding which never feeds an unpaired surrogate to TextEncoder. */
function canonicalizeString(value: string): string {
  let output = '"';
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22) {
      output += '\\"';
    } else if (codeUnit === 0x5c) {
      output += '\\\\';
    } else if (codeUnit <= 0x1f) {
      output += escapeControlCharacter(codeUnit);
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const pair = value.slice(index, index + 2);
        output += pair;
        index += 1;
      } else {
        output += `\\u${codeUnit.toString(16).padStart(4, '0')}`;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      output += `\\u${codeUnit.toString(16).padStart(4, '0')}`;
    } else {
      output += value[index];
    }
  }
  return `${output}"`;
}

function readOwnDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw canonicalizationError();
  }
  return descriptor.value;
}

function canonicalizeNumber(value: number): string {
  if (!Number.isFinite(value) || Object.is(value, -0)) {
    throw canonicalizationError();
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined || encoded === 'null') {
    throw canonicalizationError();
  }
  return encoded;
}

function canonicalizeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return canonicalizeString(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return canonicalizeNumber(value);
  }
  if (Array.isArray(value)) {
    try {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw canonicalizationError();
      }
      const parts: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
          throw canonicalizationError();
        }
        parts.push(canonicalizeValue(readOwnDataProperty(value, String(index))));
      }
      for (const key of Object.keys(value)) {
        if (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) {
          throw canonicalizationError();
        }
      }
      return `[${parts.join(',')}]`;
    } catch (error) {
      if (error instanceof DashboardCanonicalizationError) {
        throw error;
      }
      throw canonicalizationError();
    }
  }
  if (typeof value === 'object') {
    try {
      if (!isPlainObject(value)) {
        throw canonicalizationError();
      }
      const keys = Object.keys(value).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const propertyValue = readOwnDataProperty(value, key);
        parts.push(`${canonicalizeString(key)}:${canonicalizeValue(propertyValue)}`);
      }
      return `{${parts.join(',')}}`;
    } catch (error) {
      if (error instanceof DashboardCanonicalizationError) {
        throw error;
      }
      throw canonicalizationError();
    }
  }
  throw canonicalizationError();
}

/** Serialize any validated JSON-compatible value with deterministic key order. */
export function canonicalizeJson(value: unknown): string {
  return canonicalizeValue(value);
}

/** UTF-8 bytes of canonical JSON; all lone surrogates have already been escaped. */
export function canonicalJsonUtf8(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(value));
}

/** SHA-256 of the completed canonical JSON UTF-8 byte sequence. */
export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJsonUtf8(value)).digest('hex');
}
