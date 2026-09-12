import { MAX_DASHBOARD_REQUEST_BYTES } from './contracts.js';

/** Public transport failures produced before dashboard schema validation. */
export const DASHBOARD_REQUEST_ERROR_CODES = {
  invalidRequest: 'INVALID_DASHBOARD_REQUEST',
  requestTooLarge: 'REQUEST_TOO_LARGE',
  unsupportedMediaType: 'UNSUPPORTED_MEDIA_TYPE',
  unsupportedContentEncoding: 'UNSUPPORTED_CONTENT_ENCODING',
} as const;

export type DashboardRequestErrorCode =
  (typeof DASHBOARD_REQUEST_ERROR_CODES)[keyof typeof DASHBOARD_REQUEST_ERROR_CODES];

const DASHBOARD_REQUEST_ERROR_STATUS: Readonly<Record<DashboardRequestErrorCode, number>> = {
  INVALID_DASHBOARD_REQUEST: 400,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNSUPPORTED_CONTENT_ENCODING: 415,
};

/**
 * A sanitized request failure. The message deliberately contains no input
 * excerpts; callers should expose only `code` and `status` to clients.
 */
export class DashboardRequestError extends Error {
  readonly code: DashboardRequestErrorCode;
  readonly status: number;

  constructor(code: DashboardRequestErrorCode) {
    super(code);
    this.name = 'DashboardRequestError';
    this.code = code;
    this.status = DASHBOARD_REQUEST_ERROR_STATUS[code];
  }
}

const MAX_JSON_LEXICAL_DEPTH = 32;
const MAX_JSON_EXPONENT_DIGITS = String(MAX_DASHBOARD_REQUEST_BYTES).length;
const HEX_DIGITS = /^[0-9a-fA-F]$/u;

function requestError(code: DashboardRequestErrorCode): DashboardRequestError {
  return new DashboardRequestError(code);
}

function isWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function isDigit(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return code >= 0x30 && code <= 0x39;
}

function isHexDigit(character: string | undefined): boolean {
  return character !== undefined && HEX_DIGITS.test(character);
}

function stripOptionalWhitespace(value: string): string {
  return value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/gu, '');
}

function parseContentType(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const parts = value.split(';');
  const mediaType = stripOptionalWhitespace(parts[0] ?? '').toLowerCase();
  if (mediaType !== 'application/json') {
    return false;
  }
  if (parts.length === 1) {
    return true;
  }

  // The cloud endpoint intentionally accepts one optional parameter only.
  if (parts.length !== 2) {
    return false;
  }
  const parameter = stripOptionalWhitespace(parts[1] ?? '');
  const separator = parameter.indexOf('=');
  if (separator <= 0 || parameter.indexOf('=', separator + 1) !== -1) {
    return false;
  }
  const name = stripOptionalWhitespace(parameter.slice(0, separator)).toLowerCase();
  let charset = stripOptionalWhitespace(parameter.slice(separator + 1)).toLowerCase();
  if (name !== 'charset' || charset.length === 0) {
    return false;
  }
  if (charset.length >= 2 && charset[0] === '"' && charset[charset.length - 1] === '"') {
    charset = charset.slice(1, -1);
  }
  return charset === 'utf-8';
}

function parseContentEncoding(value: string | null): DashboardRequestErrorCode | null {
  if (value === null) {
    return null;
  }
  const encoding = stripOptionalWhitespace(value).toLowerCase();
  return encoding === 'identity' ? null : DASHBOARD_REQUEST_ERROR_CODES.unsupportedContentEncoding;
}

function hasValidContentLength(value: string): boolean {
  return /^[0-9]+$/u.test(value);
}

function contentLengthExceedsLimit(value: string): boolean {
  const normalized = value.replace(/^0+(?=\d)/u, '');
  const limit = String(MAX_DASHBOARD_REQUEST_BYTES);
  return (
    normalized.length > limit.length || (normalized.length === limit.length && normalized > limit)
  );
}

/**
 * Validate non-body request headers without acquiring a body reader. This is
 * intentionally safe to call before session authorization.
 */
export function checkDashboardRequestHeaders(request: Request): DashboardRequestErrorCode | null {
  let contentType: string | null;
  let contentEncoding: string | null;
  let contentLength: string | null;
  try {
    contentType = request.headers.get('content-type');
    contentEncoding = request.headers.get('content-encoding');
    contentLength = request.headers.get('content-length');
  } catch {
    return DASHBOARD_REQUEST_ERROR_CODES.invalidRequest;
  }

  if (!parseContentType(contentType)) {
    return DASHBOARD_REQUEST_ERROR_CODES.unsupportedMediaType;
  }

  const encodingError = parseContentEncoding(contentEncoding);
  if (encodingError !== null) {
    return encodingError;
  }

  if (contentLength !== null) {
    const normalizedLength = stripOptionalWhitespace(contentLength);
    if (!hasValidContentLength(normalizedLength)) {
      return DASHBOARD_REQUEST_ERROR_CODES.invalidRequest;
    }
    if (contentLengthExceedsLimit(normalizedLength)) {
      return DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge;
    }
  }

  return null;
}

function parseJsonString(
  text: string,
  start: number,
): { readonly end: number; readonly value: string } {
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const source = text.slice(start, index + 1);
      try {
        const value: unknown = JSON.parse(source);
        if (typeof value !== 'string') {
          throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
        }
        return { end: index + 1, value };
      } catch (error) {
        if (error instanceof DashboardRequestError) {
          throw error;
        }
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
    }
    if (character === '\\') {
      const escape = text[index + 1];
      if (escape === 'u') {
        if (
          !isHexDigit(text[index + 2]) ||
          !isHexDigit(text[index + 3]) ||
          !isHexDigit(text[index + 4]) ||
          !isHexDigit(text[index + 5])
        ) {
          throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
        }
        index += 6;
        continue;
      }
      if (
        escape !== '"' &&
        escape !== '\\' &&
        escape !== '/' &&
        escape !== 'b' &&
        escape !== 'f' &&
        escape !== 'n' &&
        escape !== 'r' &&
        escape !== 't'
      ) {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
      index += 2;
      continue;
    }
    if (character === undefined || character.charCodeAt(0) < 0x20) {
      throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    }
    index += 1;
  }
  throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
}

function significantDecimalIsZero(lexical: string): boolean {
  const unsigned = lexical[0] === '-' ? lexical.slice(1) : lexical;
  const mantissa = unsigned.split(/[eE]/u)[0] ?? '';
  return /^[0]+$/u.test(mantissa.replace('.', ''));
}

interface DecimalParts {
  readonly sign: -1 | 1;
  readonly digits: string;
  readonly exponent: bigint;
}

function decimalParts(value: string): DecimalParts {
  const negative = value[0] === '-';
  const unsigned = negative ? value.slice(1) : value;
  const exponentSeparator = unsigned.search(/[eE]/u);
  const mantissa = exponentSeparator === -1 ? unsigned : unsigned.slice(0, exponentSeparator);
  const exponentText = exponentSeparator === -1 ? '0' : unsigned.slice(exponentSeparator + 1);
  const normalizedExponentText = exponentText.replace(/^([+-])?0+(?=\d)/u, '$1');
  if (normalizedExponentText.replace(/^[+-]/u, '').length > MAX_JSON_EXPONENT_DIGITS) {
    throw new RangeError('JSON number exponent is outside the bounded comparison range.');
  }
  const exponent = BigInt(normalizedExponentText);
  const decimalPoint = mantissa.indexOf('.');
  const integerDigits = decimalPoint === -1 ? mantissa : mantissa.slice(0, decimalPoint);
  const fractionDigits = decimalPoint === -1 ? '' : mantissa.slice(decimalPoint + 1);
  const allDigits = `${integerDigits}${fractionDigits}`;
  const leadingZeroCount = allDigits.search(/[1-9]/u);
  if (leadingZeroCount === -1) {
    return { sign: 1, digits: '0', exponent: 0n };
  }
  const withoutLeadingZeros = allDigits.slice(leadingZeroCount);
  const trailingZeroMatch = withoutLeadingZeros.match(/0+$/u);
  const trailingZeroCount = trailingZeroMatch?.[0].length ?? 0;
  const digits =
    trailingZeroCount === 0
      ? withoutLeadingZeros
      : withoutLeadingZeros.slice(0, withoutLeadingZeros.length - trailingZeroCount);
  const decimalExponent = BigInt(integerDigits.length) + exponent - BigInt(allDigits.length);
  return {
    sign: negative ? -1 : 1,
    digits,
    exponent: decimalExponent + BigInt(trailingZeroCount),
  };
}

function areEquivalentDecimalSpellings(left: string, right: string): boolean {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  return (
    leftParts.sign === rightParts.sign &&
    leftParts.digits === rightParts.digits &&
    leftParts.exponent === rightParts.exponent
  );
}

function validateJsonNumber(lexical: string): void {
  const negative = lexical[0] === '-';
  const isZero = significantDecimalIsZero(lexical);
  if (negative && isZero) {
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }

  const number = Number(lexical);
  if (!Number.isFinite(number) || (number === 0 && !isZero) || Object.is(number, -0)) {
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }
  if (isZero) {
    return;
  }
  if (Number.isInteger(number)) {
    try {
      if (!areEquivalentDecimalSpellings(lexical, BigInt(number).toString())) {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
    } catch (error) {
      if (error instanceof DashboardRequestError) {
        throw error;
      }
      throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    }
    return;
  }
  const canonical = JSON.stringify(number);
  if (canonical === undefined || canonical === 'null') {
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }
  try {
    if (!areEquivalentDecimalSpellings(lexical, canonical)) {
      throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    }
  } catch (error) {
    if (error instanceof DashboardRequestError) {
      throw error;
    }
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }
}

class StrictJsonScanner {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  scan(): void {
    this.skipWhitespace();
    this.parseValue(0);
    this.skipWhitespace();
    if (this.#index !== this.#text.length) {
      throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    }
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.#text[this.#index])) {
      this.#index += 1;
    }
  }

  private parseValue(containerDepth: number): void {
    this.skipWhitespace();
    const character = this.#text[this.#index];
    if (character === '"') {
      this.#index = parseJsonString(this.#text, this.#index).end;
      return;
    }
    if (character === '{') {
      this.parseObject(containerDepth + 1);
      return;
    }
    if (character === '[') {
      this.parseArray(containerDepth + 1);
      return;
    }
    if (character === 'n') {
      this.consumeLiteral('null');
      return;
    }
    if (character === 't') {
      this.consumeLiteral('true');
      return;
    }
    if (character === 'f') {
      this.consumeLiteral('false');
      return;
    }
    if (character === '-' || isDigit(character)) {
      this.parseNumber();
      return;
    }
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }

  private parseObject(depth: number): void {
    if (depth > MAX_JSON_LEXICAL_DEPTH) {
      throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    }
    this.#index += 1;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.#text[this.#index] === '}') {
      this.#index += 1;
      return;
    }
    while (this.#index < this.#text.length) {
      if (this.#text[this.#index] !== '"') {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
      const parsedKey = parseJsonString(this.#text, this.#index);
      this.#index = parsedKey.end;
      if (keys.has(parsedKey.value)) {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
      keys.add(parsedKey.value);
      this.skipWhitespace();
      if (this.#text[this.#index] !== ':') {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
      this.#index += 1;
      this.parseValue(depth);
      this.skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === '}') {
        this.#index += 1;
        return;
      }
      if (separator !== ',') {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
      this.#index += 1;
      this.skipWhitespace();
    }
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }

  private parseArray(depth: number): void {
    if (depth > MAX_JSON_LEXICAL_DEPTH) {
      throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    }
    this.#index += 1;
    this.skipWhitespace();
    if (this.#text[this.#index] === ']') {
      this.#index += 1;
      return;
    }
    while (this.#index < this.#text.length) {
      this.parseValue(depth);
      this.skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === ']') {
        this.#index += 1;
        return;
      }
      if (separator !== ',') {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
      this.#index += 1;
      this.skipWhitespace();
    }
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }

  private parseNumber(): void {
    const start = this.#index;
    let index = start;
    if (this.#text[index] === '-') {
      index += 1;
    }
    const firstDigit = this.#text[index];
    if (firstDigit === '0') {
      index += 1;
    } else if (firstDigit !== undefined && firstDigit >= '1' && firstDigit <= '9') {
      index += 1;
      while (isDigit(this.#text[index])) {
        index += 1;
      }
    } else {
      throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    }

    if (this.#text[index] === '.') {
      index += 1;
      const fractionStart = index;
      while (isDigit(this.#text[index])) {
        index += 1;
      }
      if (index === fractionStart) {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
    }

    if (this.#text[index] === 'e' || this.#text[index] === 'E') {
      index += 1;
      if (this.#text[index] === '+' || this.#text[index] === '-') {
        index += 1;
      }
      const exponentStart = index;
      while (isDigit(this.#text[index])) {
        index += 1;
      }
      if (index === exponentStart) {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
    }

    const lexical = this.#text.slice(start, index);
    this.#index = index;
    validateJsonNumber(lexical);
  }

  private consumeLiteral(literal: string): void {
    if (this.#text.slice(this.#index, this.#index + literal.length) !== literal) {
      throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
    }
    this.#index += literal.length;
  }
}

/** Parse JSON after a strict lexical pass, retaining JSON.parse's value semantics. */
export function parseStrictJsonText(text: string): unknown {
  if (text.length > MAX_DASHBOARD_REQUEST_BYTES) {
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge);
  }
  try {
    new StrictJsonScanner(text).scan();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof DashboardRequestError) {
      throw error;
    }
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }
}

/** Decode a complete request body with fatal UTF-8 and BOM checks before parsing JSON. */
export function parseStrictJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_DASHBOARD_REQUEST_BYTES) {
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge);
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }
  return parseStrictJsonText(text);
}

/**
 * Read and bound a request stream. The caller should invoke header preflight and
 * authorization first; the repeated preflight here protects direct callers.
 */
export async function readDashboardRequestBody(request: Request): Promise<unknown> {
  const headerError = checkDashboardRequestHeaders(request);
  if (headerError !== null) {
    throw requestError(headerError);
  }

  const body = request.body;
  if (body === null) {
    return parseStrictJsonBytes(new Uint8Array());
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  }

  let bytes = new Uint8Array(0);
  let byteCount = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
      }
      byteCount += result.value.byteLength;
      if (byteCount > MAX_DASHBOARD_REQUEST_BYTES) {
        // Do not await an untrusted stream's cancellation promise: the fixed
        // 413 must not be delayed by a source that never settles cancellation.
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // The public result remains the fixed size error if cancellation throws.
        }
        throw requestError(DASHBOARD_REQUEST_ERROR_CODES.requestTooLarge);
      }
      if (byteCount > bytes.byteLength) {
        let capacity = Math.max(bytes.byteLength, 1);
        while (capacity < byteCount) {
          capacity = Math.min(MAX_DASHBOARD_REQUEST_BYTES, Math.max(capacity * 2, byteCount));
        }
        const expanded = new Uint8Array(capacity);
        expanded.set(bytes);
        bytes = expanded;
      }
      bytes.set(result.value, byteCount - result.value.byteLength);
    }
  } catch (error) {
    if (error instanceof DashboardRequestError) {
      throw error;
    }
    throw requestError(DASHBOARD_REQUEST_ERROR_CODES.invalidRequest);
  } finally {
    reader.releaseLock();
  }

  return parseStrictJsonBytes(bytes.subarray(0, byteCount));
}

export { MAX_JSON_LEXICAL_DEPTH };
