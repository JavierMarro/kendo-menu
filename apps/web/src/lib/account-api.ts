/**
 * Strict browser boundary for the account/session and dashboard HTTP contracts.
 *
 * This module intentionally does not import the server application.  The server
 * contracts run in Node and include persistence concerns; the browser repeats
 * the small wire validation needed before account data is allowed into a store.
 * Cookies remain browser-managed credentials.  The only cookie read here is the
 * session-bound CSRF cookie immediately before a mutation.
 */
import {
  parseDashboardPersistenceV10,
  type PersistedTrainingWireStateV10,
} from '@kendo-menu/domain/dashboard-persistence';

export const SESSION_ENDPOINT = '/api/session';
export const DASHBOARD_ENDPOINT = '/api/dashboard';
export const CSRF_COOKIE_NAME = '__Host-kendomenu-csrf';

/** The complete server-side request limit, including the dashboard envelope. */
export const MAX_DASHBOARD_REQUEST_BYTES = 2_097_152;
const MAX_REVISION = '9223372036854775807';

/**
 * The server bounds the canonical stored dashboard snapshot to the same 2 MiB
 * limit as the complete PUT envelope.  Read responses add only their fixed,
 * allow-listed envelope.  Compute that exact UTF-8 difference from worst-case
 * field lengths instead of reserving space for unspecified future fields.  This
 * also covers any number spelling expansion performed by server canonicalization:
 * the canonical snapshot is measured against the server limit before storage.
 */
const MAX_ACCOUNT_WORKSPACE_ID_CHARACTERS = 36;
const MAX_CATALOGUE_VERSION_CHARACTERS = 64;
const MAX_REVISION_CHARACTERS = MAX_REVISION.length;
const MAX_TIMESTAMP_CHARACTERS = 24;
const EMPTY_DASHBOARD_SNAPSHOT = { version: 10, state: { dashboardEntries: [] } } as const;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

const MAX_READ_RESPONSE_WITH_EMPTY_SNAPSHOT_BYTES = utf8ByteLength(
  JSON.stringify({
    transportVersion: 1,
    accountWorkspaceId: '0'.repeat(MAX_ACCOUNT_WORKSPACE_ID_CHARACTERS),
    catalogueVersion: '0'.repeat(MAX_CATALOGUE_VERSION_CHARACTERS),
    revision: '9'.repeat(MAX_REVISION_CHARACTERS),
    dashboard: EMPTY_DASHBOARD_SNAPSHOT,
    updatedAt: '9'.repeat(MAX_TIMESTAMP_CHARACTERS),
  }),
);
const EMPTY_DASHBOARD_SNAPSHOT_BYTES = utf8ByteLength(JSON.stringify(EMPTY_DASHBOARD_SNAPSHOT));

export const MAX_DASHBOARD_RESPONSE_ENVELOPE_OVERHEAD_BYTES =
  MAX_READ_RESPONSE_WITH_EMPTY_SNAPSHOT_BYTES - EMPTY_DASHBOARD_SNAPSHOT_BYTES;
export const MAX_JSON_RESPONSE_BYTES =
  MAX_DASHBOARD_REQUEST_BYTES + MAX_DASHBOARD_RESPONSE_ENVELOPE_OVERHEAD_BYTES;

const MAX_ERROR_RESPONSE_BYTES = 8 * 1024;
const MAX_EMAIL_CHARACTERS = 320;
const MAX_CSRF_TOKEN_LENGTH = 43;

const ACCOUNT_WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CATALOGUE_VERSION_PATTERN = /^[0-9a-f]{64}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type AccountApiErrorKind =
  | 'network'
  | 'aborted'
  | 'redirect'
  | 'content-type'
  | 'oversized'
  | 'malformed-json'
  | 'invalid-response'
  | 'csrf'
  | 'request-invalid'
  | 'http';

/** Fixed, non-sensitive failures exposed by the browser boundary. */
export class AccountApiError extends Error {
  readonly kind: AccountApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(
    kind: AccountApiErrorKind,
    message: string,
    options: {
      readonly status?: number;
      readonly code?: string;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'AccountApiError';
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
    this.retryable = options.retryable ?? (kind === 'network' || kind === 'aborted');
  }
}

export type AdoptionStatus =
  | { readonly status: 'pending'; readonly capability: boolean }
  | { readonly status: 'unavailable'; readonly capability: false }
  | {
      readonly status: 'accepted';
      readonly capability: false;
      readonly completion: {
        readonly decision: 'yes';
        readonly requestId: string;
        readonly acknowledgedRevision: string;
        readonly timestamp: string;
      };
    }
  | {
      readonly status: 'declined';
      readonly capability: false;
      readonly completion: { readonly decision: 'no'; readonly requestId: string };
    };

export interface AccountSession {
  readonly userId: string;
  readonly verifiedGoogleEmail: string | null;
  readonly adoption: AdoptionStatus;
}

export type SessionResult =
  | { readonly status: 'authenticated'; readonly session: AccountSession }
  | { readonly status: 'signed-out' };

export interface DashboardSnapshot {
  readonly version: 10;
  readonly state: PersistedTrainingWireStateV10;
}

export interface DashboardReadResponse {
  readonly transportVersion: 1;
  readonly accountWorkspaceId: string;
  readonly catalogueVersion: string;
  readonly revision: string;
  readonly dashboard: DashboardSnapshot | null;
  readonly updatedAt: string | null;
}

export interface DashboardWriteRequest {
  readonly transportVersion: 1;
  readonly expectedAccountWorkspaceId: string;
  readonly expectedRevision: string;
  readonly requestId: string;
  readonly catalogueVersion: string;
  readonly dashboard: DashboardSnapshot;
}

export interface DashboardWriteAcknowledgement {
  readonly transportVersion: 1;
  readonly accountWorkspaceId: string;
  readonly requestId: string;
  readonly revision: string;
  readonly updatedAt: string;
}

export interface AccountApiClient {
  getSession(signal?: AbortSignal): Promise<SessionResult>;
  logout(signal?: AbortSignal): Promise<void>;
  getDashboard(accountWorkspaceId: string, signal?: AbortSignal): Promise<DashboardReadResponse>;
  putDashboard(
    accountWorkspaceId: string,
    request: DashboardWriteRequest,
    signal?: AbortSignal,
  ): Promise<DashboardWriteAcknowledgement>;
}

export interface AccountApiDependencies {
  /** `fetch` is injected so tests never need a network or a real browser session. */
  readonly fetch?: typeof fetch;
  /** Reads `document.cookie`; this is called only for logout and dashboard PUT. */
  readonly readCookie?: () => string;
  /** The current application origin used to reject cross-origin final responses. */
  readonly origin?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    const ownKeys = Object.keys(value);
    return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  } catch {
    return false;
  }
}

export function isAccountWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_WORKSPACE_ID_PATTERN.test(value);
}

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function isRevision(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:0|[1-9][0-9]{0,18})$/u.test(value) &&
    (value.length < MAX_REVISION.length || value <= MAX_REVISION)
  );
}

export function isNonZeroRevision(value: unknown): value is string {
  return isRevision(value) && value !== '0';
}

export function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isCatalogueVersion(value: unknown): value is string {
  return typeof value === 'string' && CATALOGUE_VERSION_PATTERN.test(value);
}

function isSafeEmail(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_EMAIL_CHARACTERS ||
    value.trim() !== value
  ) {
    return false;
  }
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined && !(codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

function isCanonicalBase64UrlToken(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length !== MAX_CSRF_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    return false;
  }

  try {
    const binary = globalThis.atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    if (binary.length !== 32) return false;
    const canonical = globalThis
      .btoa(binary)
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');
    return canonical === value;
  } catch {
    return false;
  }
}

function isStrictJsonObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    return (
      Reflect.getPrototypeOf(value) === Object.prototype || Reflect.getPrototypeOf(value) === null
    );
  } catch {
    return false;
  }
}

function parseAdoptionStatus(value: unknown): AdoptionStatus | null {
  if (!isStrictJsonObject(value)) return null;
  const status = value['status'];
  const capability = value['capability'];
  if (status === 'pending' || status === 'unavailable') {
    if (
      !hasExactKeys(value, ['status', 'capability']) ||
      typeof capability !== 'boolean' ||
      (status === 'unavailable' && capability)
    ) {
      return null;
    }
    return status === 'unavailable'
      ? Object.freeze({ status, capability: false })
      : Object.freeze({ status, capability });
  }

  if (status !== 'accepted' && status !== 'declined') return null;
  if (!hasExactKeys(value, ['status', 'capability', 'completion']) || capability !== false) {
    return null;
  }
  const completion = value['completion'];
  if (!isStrictJsonObject(completion)) return null;
  if (status === 'declined') {
    const requestId = completion['requestId'];
    if (
      !hasExactKeys(completion, ['decision', 'requestId']) ||
      completion['decision'] !== 'no' ||
      !isRequestId(requestId)
    ) {
      return null;
    }
    return Object.freeze({
      status,
      capability: false,
      completion: Object.freeze({ decision: 'no', requestId }),
    });
  }

  const requestId = completion['requestId'];
  const acknowledgedRevision = completion['acknowledgedRevision'];
  const timestamp = completion['timestamp'];
  if (
    !hasExactKeys(completion, ['decision', 'requestId', 'acknowledgedRevision', 'timestamp']) ||
    completion['decision'] !== 'yes' ||
    !isRequestId(requestId) ||
    !isNonZeroRevision(acknowledgedRevision) ||
    !isTimestamp(timestamp)
  ) {
    return null;
  }
  return Object.freeze({
    status,
    capability: false,
    completion: Object.freeze({ decision: 'yes', requestId, acknowledgedRevision, timestamp }),
  });
}

function parseSession(value: unknown): AccountSession | null {
  // Only the internal user ID selects a local account workspace. The verified email is
  // display data; accepting it as a storage key would mix identity and presentation.
  if (
    !isStrictJsonObject(value) ||
    !hasExactKeys(value, ['userId', 'verifiedGoogleEmail', 'adoption']) ||
    !isAccountWorkspaceId(value['userId']) ||
    (value['verifiedGoogleEmail'] !== null && !isSafeEmail(value['verifiedGoogleEmail']))
  ) {
    return null;
  }
  const adoption = parseAdoptionStatus(value['adoption']);
  if (adoption === null) return null;
  return Object.freeze({
    userId: value['userId'],
    verifiedGoogleEmail: value['verifiedGoogleEmail'],
    adoption,
  });
}

function parseDashboardSnapshot(value: unknown): DashboardSnapshot | null {
  if (
    !isStrictJsonObject(value) ||
    !hasExactKeys(value, ['version', 'state']) ||
    value['version'] !== 10
  ) {
    return null;
  }
  const state = parseDashboardPersistenceV10(value['state']);
  return state === null ? null : Object.freeze({ version: 10, state });
}

function parseDashboardRead(
  value: unknown,
  accountWorkspaceId: string,
): DashboardReadResponse | null {
  if (
    !isStrictJsonObject(value) ||
    !hasExactKeys(value, [
      'transportVersion',
      'accountWorkspaceId',
      'catalogueVersion',
      'revision',
      'dashboard',
      'updatedAt',
    ]) ||
    value['transportVersion'] !== 1 ||
    value['accountWorkspaceId'] !== accountWorkspaceId ||
    !isAccountWorkspaceId(value['accountWorkspaceId']) ||
    !isCatalogueVersion(value['catalogueVersion']) ||
    !isRevision(value['revision'])
  ) {
    return null;
  }

  const revision = value['revision'];
  if (revision === '0') {
    return value['dashboard'] === null && value['updatedAt'] === null
      ? Object.freeze({
          transportVersion: 1,
          accountWorkspaceId,
          catalogueVersion: value['catalogueVersion'],
          revision: '0',
          dashboard: null,
          updatedAt: null,
        })
      : null;
  }

  if (!isNonZeroRevision(revision) || !isTimestamp(value['updatedAt'])) return null;
  const dashboard = parseDashboardSnapshot(value['dashboard']);
  return dashboard === null
    ? null
    : Object.freeze({
        transportVersion: 1,
        accountWorkspaceId,
        catalogueVersion: value['catalogueVersion'],
        revision,
        dashboard,
        updatedAt: value['updatedAt'],
      });
}

function parseDashboardAcknowledgement(
  value: unknown,
  accountWorkspaceId: string,
  request: DashboardWriteRequest,
): DashboardWriteAcknowledgement | null {
  if (
    !isStrictJsonObject(value) ||
    !hasExactKeys(value, [
      'transportVersion',
      'accountWorkspaceId',
      'requestId',
      'revision',
      'updatedAt',
    ]) ||
    value['transportVersion'] !== 1 ||
    value['accountWorkspaceId'] !== accountWorkspaceId ||
    !isAccountWorkspaceId(value['accountWorkspaceId']) ||
    value['requestId'] !== request.requestId ||
    !isRequestId(value['requestId']) ||
    !isNonZeroRevision(value['revision']) ||
    !isTimestamp(value['updatedAt'])
  ) {
    return null;
  }

  try {
    if (BigInt(value['revision']) !== BigInt(request.expectedRevision) + 1n) return null;
  } catch {
    return null;
  }
  return Object.freeze({
    transportVersion: 1,
    accountWorkspaceId,
    requestId: request.requestId,
    revision: value['revision'],
    updatedAt: value['updatedAt'],
  });
}

function validateDashboardWriteRequest(
  value: unknown,
  accountWorkspaceId: string,
): DashboardWriteRequest | null {
  if (
    !isStrictJsonObject(value) ||
    !hasExactKeys(value, [
      'transportVersion',
      'expectedAccountWorkspaceId',
      'expectedRevision',
      'requestId',
      'catalogueVersion',
      'dashboard',
    ]) ||
    value['transportVersion'] !== 1 ||
    value['expectedAccountWorkspaceId'] !== accountWorkspaceId ||
    !isAccountWorkspaceId(value['expectedAccountWorkspaceId']) ||
    !isRevision(value['expectedRevision']) ||
    !isRequestId(value['requestId']) ||
    !isCatalogueVersion(value['catalogueVersion'])
  ) {
    return null;
  }
  const dashboard = parseDashboardSnapshot(value['dashboard']);
  return dashboard === null
    ? null
    : Object.freeze({
        transportVersion: 1,
        expectedAccountWorkspaceId: accountWorkspaceId,
        expectedRevision: value['expectedRevision'],
        requestId: value['requestId'],
        catalogueVersion: value['catalogueVersion'],
        dashboard,
      });
}

/** Scan JSON syntax solely to reject duplicate object keys before JSON.parse loses them. */
function rejectDuplicateJsonKeys(input: string): void {
  let index = 0;
  const length = input.length;
  const isWhitespace = (character: string | undefined): boolean =>
    character === ' ' || character === '\t' || character === '\n' || character === '\r';
  const skipWhitespace = (): void => {
    while (index < length && isWhitespace(input[index])) index += 1;
  };
  const readString = (): string => {
    const start = index;
    if (input[index] !== '"') throw new Error('JSON_STRING');
    index += 1;
    while (index < length) {
      const character = input[index];
      if (character === '"') {
        index += 1;
        return JSON.parse(input.slice(start, index)) as string;
      }
      if (character === '\\') {
        index += 1;
        if (index >= length) throw new Error('JSON_ESCAPE');
        if (input[index] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(input.slice(index + 1, index + 5))) {
            throw new Error('JSON_ESCAPE');
          }
          index += 5;
        } else {
          index += 1;
        }
      } else {
        if (character !== undefined && character < ' ') throw new Error('JSON_CONTROL');
        index += 1;
      }
    }
    throw new Error('JSON_STRING');
  };
  const readValue = (): void => {
    skipWhitespace();
    const character = input[index];
    if (character === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (input[index] === '}') {
        index += 1;
        return;
      }
      while (index < length) {
        skipWhitespace();
        const key = readString();
        if (keys.has(key)) throw new Error('JSON_DUPLICATE_KEY');
        keys.add(key);
        skipWhitespace();
        if (input[index] !== ':') throw new Error('JSON_COLON');
        index += 1;
        readValue();
        skipWhitespace();
        if (input[index] === '}') {
          index += 1;
          return;
        }
        if (input[index] !== ',') throw new Error('JSON_OBJECT');
        index += 1;
      }
      throw new Error('JSON_OBJECT');
    }
    if (character === '[') {
      index += 1;
      skipWhitespace();
      if (input[index] === ']') {
        index += 1;
        return;
      }
      while (index < length) {
        readValue();
        skipWhitespace();
        if (input[index] === ']') {
          index += 1;
          return;
        }
        if (input[index] !== ',') throw new Error('JSON_ARRAY');
        index += 1;
      }
      throw new Error('JSON_ARRAY');
    }
    if (character === '"') {
      readString();
      return;
    }
    const primitiveStart = index;
    while (
      index < length &&
      !isWhitespace(input[index]) &&
      input[index] !== ',' &&
      input[index] !== ']' &&
      input[index] !== '}'
    )
      index += 1;
    if (index === primitiveStart) throw new Error('JSON_VALUE');
  };

  readValue();
  skipWhitespace();
  if (index !== length) throw new Error('JSON_TRAILING');
}

function parseJson(text: string): unknown {
  try {
    rejectDuplicateJsonKeys(text);
    return JSON.parse(text) as unknown;
  } catch {
    throw new AccountApiError('malformed-json', 'The account response was not valid JSON.');
  }
}

function responseHeader(response: Response, name: string): string | null {
  try {
    return response.headers.get(name);
  } catch {
    throw new AccountApiError('invalid-response', 'The account response headers were invalid.');
  }
}

function responseContentLength(response: Response, limit: number): void {
  const header = responseHeader(response, 'content-length');
  if (header === null) return;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(header)) {
    throw new AccountApiError('invalid-response', 'The account response length was invalid.');
  }
  try {
    if (BigInt(header) > BigInt(limit)) {
      throw new AccountApiError('oversized', 'The account response exceeded its size limit.');
    }
  } catch (error) {
    if (error instanceof AccountApiError) throw error;
    throw new AccountApiError('invalid-response', 'The account response length was invalid.');
  }
}

async function readBodyBytes(response: Response, limit: number): Promise<Uint8Array> {
  responseContentLength(response, limit);
  let body: ReadableStream<Uint8Array> | null;
  try {
    body = response.body;
  } catch {
    throw new AccountApiError('invalid-response', 'The account response body was invalid.');
  }
  if (body === null) {
    throw new AccountApiError('malformed-json', 'The account response had no body.');
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw new AccountApiError('invalid-response', 'The account response body was invalid.');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (
        !ArrayBuffer.isView(chunk) ||
        Object.prototype.toString.call(chunk) !== '[object Uint8Array]'
      ) {
        throw new AccountApiError('invalid-response', 'The account response body was invalid.');
      }
      const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      total += bytes.byteLength;
      if (total > limit) {
        throw new AccountApiError('oversized', 'The account response exceeded its size limit.');
      }
      chunks.push(bytes);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // A failed body is already represented by the typed response error.
    }
    if (error instanceof AccountApiError) throw error;
    throw new AccountApiError('network', 'The account response could not be read.', {
      retryable: true,
    });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJsonBody(response: Response, limit: number): Promise<unknown> {
  const bytes = await readBodyBytes(response, limit);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return parseJson(text);
  } catch (error) {
    if (error instanceof AccountApiError) throw error;
    throw new AccountApiError('malformed-json', 'The account response was not valid UTF-8 JSON.');
  }
}

function validateResponseEnvelope(
  response: Response,
  endpoint: string,
  origin: string | undefined,
): void {
  try {
    if (response.redirected || response.type === 'opaqueredirect' || response.type === 'opaque') {
      throw new AccountApiError('redirect', 'The account response was redirected.');
    }
    const url = response.url;
    if (url === '') return;
    const resolved = new URL(url, origin ?? 'https://kendo-menu.invalid');
    if (
      origin === undefined ||
      resolved.origin !== origin ||
      resolved.pathname !== endpoint ||
      resolved.search !== ''
    ) {
      throw new AccountApiError('redirect', 'The account response was not same-origin.');
    }
  } catch (error) {
    if (error instanceof AccountApiError) throw error;
    throw new AccountApiError('invalid-response', 'The account response metadata was invalid.');
  }
}

function validateJsonContentType(response: Response): void {
  const value = responseHeader(response, 'content-type');
  if (value === null || value.includes(',')) {
    throw new AccountApiError('content-type', 'The account response was not JSON.');
  }
  const [mediaType, ...parameters] = value.split(';').map((part) => part.trim().toLowerCase());
  if (
    mediaType !== 'application/json' ||
    parameters.some((parameter) => parameter !== 'charset=utf-8')
  ) {
    throw new AccountApiError('content-type', 'The account response was not JSON.');
  }
}

function parseErrorCode(value: unknown): string | null {
  if (
    !isStrictJsonObject(value) ||
    !hasExactKeys(value, ['error']) ||
    typeof value['error'] !== 'string'
  ) {
    return null;
  }
  const code = value['error'];
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : null;
}

function errorForStatus(status: number, code: string): AccountApiError {
  return new AccountApiError('http', 'The account request was rejected.', {
    status,
    code,
    retryable: status >= 500,
  });
}

function readCookieHeader(): string {
  try {
    return typeof document === 'undefined' ? '' : document.cookie;
  } catch {
    return '';
  }
}

function csrfHeader(readCookie: () => string): string {
  let cookieHeader: string;
  try {
    cookieHeader = readCookie();
  } catch {
    throw new AccountApiError('csrf', 'The CSRF cookie could not be read.');
  }
  if (typeof cookieHeader !== 'string') {
    throw new AccountApiError('csrf', 'The CSRF cookie could not be read.');
  }
  let token: string | undefined;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) {
      if (trimmed === CSRF_COOKIE_NAME) {
        throw new AccountApiError('csrf', 'The CSRF cookie was missing or malformed.');
      }
      continue;
    }
    const name = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (name !== CSRF_COOKIE_NAME) continue;
    if (token !== undefined || !isCanonicalBase64UrlToken(value)) {
      throw new AccountApiError('csrf', 'The CSRF cookie was missing or malformed.');
    }
    token = value;
  }
  if (token === undefined) {
    throw new AccountApiError('csrf', 'The CSRF cookie was missing or malformed.');
  }
  return token;
}

function validateEndpointAccountId(accountWorkspaceId: string): void {
  if (!isAccountWorkspaceId(accountWorkspaceId)) {
    throw new AccountApiError('request-invalid', 'The account workspace identifier was invalid.');
  }
}

function resolveOrigin(dependencyOrigin: string | undefined): string | undefined {
  if (dependencyOrigin !== undefined) return dependencyOrigin;
  try {
    return typeof location === 'undefined' ? undefined : location.origin;
  } catch {
    return undefined;
  }
}

function assertResponseStatus(response: Response): number {
  let status: number;
  try {
    status = response.status;
  } catch {
    throw new AccountApiError('invalid-response', 'The account response status was invalid.');
  }
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new AccountApiError('invalid-response', 'The account response status was invalid.');
  }
  return status;
}

async function readErrorResponse(response: Response, status: number): Promise<AccountApiError> {
  validateJsonContentType(response);
  const body = await readJsonBody(response, MAX_ERROR_RESPONSE_BYTES);
  const code = parseErrorCode(body);
  if (code === null) {
    throw new AccountApiError('invalid-response', 'The account error response was invalid.', {
      status,
      retryable: status >= 500,
    });
  }
  return errorForStatus(status, code);
}

export function createAccountApiClient(
  dependencies: AccountApiDependencies = {},
): AccountApiClient {
  const requestFetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const readCookie = dependencies.readCookie ?? readCookieHeader;
  const origin = resolveOrigin(dependencies.origin);

  async function request(
    endpoint: string,
    method: 'GET' | 'DELETE' | 'PUT',
    signal: AbortSignal | undefined,
    headers: HeadersInit,
    body?: string,
  ): Promise<{ readonly response: Response; readonly status: number }> {
    // Redirects are rejected so a login page cannot masquerade as API JSON. Bypass caches
    // so session and dashboard reads reflect the server's current state.
    if (signal?.aborted) {
      throw new AccountApiError('aborted', 'The account request was aborted.');
    }
    const init: RequestInit = {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      ...(body === undefined ? {} : { body }),
      ...(signal === undefined ? {} : { signal }),
    };
    let response: Response;
    try {
      response = await requestFetch(endpoint, init);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw new AccountApiError('aborted', 'The account request was aborted.');
      }
      throw new AccountApiError('network', 'The account request could not be completed.', {
        retryable: true,
      });
    }
    validateResponseEnvelope(response, endpoint, origin);
    const status = assertResponseStatus(response);
    return { response, status };
  }

  return {
    async getSession(signal): Promise<SessionResult> {
      const { response, status } = await request(SESSION_ENDPOINT, 'GET', signal, {
        accept: 'application/json',
      });
      if (status === 401) {
        const error = await readErrorResponse(response, status);
        if (error.code !== 'UNAUTHENTICATED') throw error;
        return { status: 'signed-out' };
      }
      if (status !== 200) throw await readErrorResponse(response, status);
      validateJsonContentType(response);
      const session = parseSession(await readJsonBody(response, MAX_ERROR_RESPONSE_BYTES));
      if (session === null) {
        throw new AccountApiError('invalid-response', 'The account session response was invalid.', {
          status,
        });
      }
      return { status: 'authenticated', session };
    },

    async logout(signal): Promise<void> {
      const csrf = csrfHeader(readCookie);
      const { response, status } = await request(SESSION_ENDPOINT, 'DELETE', signal, {
        accept: 'application/json',
        'x-csrf-token': csrf,
      });
      if (status === 204) {
        if (responseHeader(response, 'content-type') !== null) {
          throw new AccountApiError('content-type', 'The logout response had an unexpected type.', {
            status,
          });
        }
        responseContentLength(response, 0);
        if (response.body !== null) {
          const bytes = await readBodyBytes(response, 0);
          if (bytes.byteLength !== 0) {
            throw new AccountApiError('invalid-response', 'The logout response had a body.', {
              status,
            });
          }
        }
        return;
      }
      throw await readErrorResponse(response, status);
    },

    async getDashboard(accountWorkspaceId, signal): Promise<DashboardReadResponse> {
      validateEndpointAccountId(accountWorkspaceId);
      const { response, status } = await request(DASHBOARD_ENDPOINT, 'GET', signal, {
        accept: 'application/json',
      });
      if (status !== 200) throw await readErrorResponse(response, status);
      validateJsonContentType(response);
      const dashboard = parseDashboardRead(
        await readJsonBody(response, MAX_JSON_RESPONSE_BYTES),
        accountWorkspaceId,
      );
      if (dashboard === null) {
        throw new AccountApiError('invalid-response', 'The dashboard response was invalid.', {
          status,
        });
      }
      return dashboard;
    },

    async putDashboard(accountWorkspaceId, input, signal): Promise<DashboardWriteAcknowledgement> {
      validateEndpointAccountId(accountWorkspaceId);
      const requestValue = validateDashboardWriteRequest(input, accountWorkspaceId);
      if (requestValue === null) {
        throw new AccountApiError('request-invalid', 'The dashboard request was invalid.');
      }
      let body: string;
      try {
        body = JSON.stringify(requestValue);
      } catch {
        throw new AccountApiError('request-invalid', 'The dashboard request was invalid.');
      }
      if (new TextEncoder().encode(body).byteLength > MAX_DASHBOARD_REQUEST_BYTES) {
        throw new AccountApiError('oversized', 'The dashboard request exceeded its size limit.');
      }
      const csrf = csrfHeader(readCookie);
      const { response, status } = await request(
        DASHBOARD_ENDPOINT,
        'PUT',
        signal,
        {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body,
      );
      if (status !== 200) throw await readErrorResponse(response, status);
      validateJsonContentType(response);
      const acknowledgement = parseDashboardAcknowledgement(
        await readJsonBody(response, MAX_ERROR_RESPONSE_BYTES),
        accountWorkspaceId,
        requestValue,
      );
      if (acknowledgement === null) {
        throw new AccountApiError(
          'invalid-response',
          'The dashboard acknowledgement was invalid.',
          {
            status,
          },
        );
      }
      return acknowledgement;
    },
  };
}
