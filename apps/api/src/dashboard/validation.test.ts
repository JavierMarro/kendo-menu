import { describe, expect, it } from 'vitest';

import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  isCatalogueVersion,
  isNonZeroRevision,
  isRequestId,
  isRevision,
  isTimestamp,
  validateDashboardAcknowledgement,
  validateDashboardWrite,
} from './validation.js';
import { parseStrictJsonText } from './request-body.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = '00000000-0000-4000-8000-000000000002';
const TIMESTAMP = '2026-09-12T00:00:00.123Z';
const CATALOGUE = 'a'.repeat(64);
function envelope() {
  return {
    transportVersion: 1,
    expectedAccountWorkspaceId: USER_ID,
    expectedRevision: '0',
    requestId: REQUEST_ID,
    catalogueVersion: CATALOGUE,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
  };
}
function validate(value: unknown) {
  if (!isAccountWorkspaceId(USER_ID)) throw new Error('BAD_FIXTURE');
  return validateDashboardWrite(value, USER_ID);
}
function intent(value: unknown = envelope()) {
  const result = validate(value);
  if (result.status !== 'valid') throw new Error('BAD_FIXTURE');
  return result.intent;
}

describe('transport refinements', () => {
  it.each(['0', '1', '9223372036854775807'])('accepts bounded revision %s', (value) =>
    expect(isRevision(value)).toBe(true),
  );
  it.each([
    '',
    '-1',
    '+1',
    '01',
    '1.0',
    '1e1',
    '9223372036854775808',
    '99999999999999999999',
    1,
    null,
  ])('rejects revision %s', (value) => expect(isRevision(value)).toBe(false));
  it('refines UUIDs, nonzero revisions, digest, and exact millisecond UTC time', () => {
    expect(isAccountWorkspaceId(USER_ID)).toBe(true);
    expect(isAccountWorkspaceId('ABCDEF00-0000-4000-8000-000000000001')).toBe(false);
    expect(isRequestId(REQUEST_ID)).toBe(true);
    expect(isRequestId('00000000-0000-5000-8000-000000000002')).toBe(false);
    expect(isRequestId('00000000-0000-4000-7000-000000000002')).toBe(false);
    expect(isNonZeroRevision('0')).toBe(false);
    expect(isNonZeroRevision('1')).toBe(true);
    expect(isCatalogueVersion(CATALOGUE)).toBe(true);
    expect(isCatalogueVersion(CATALOGUE.toUpperCase())).toBe(false);
    expect(isCatalogueVersion('a'.repeat(63))).toBe(false);
    expect(isTimestamp(TIMESTAMP)).toBe(true);
    for (const value of [
      '2026-02-30T00:00:00.000Z',
      '2026-09-12T00:00:00Z',
      '2026-09-12T00:00:00.000+00:00',
      '2026-09-12T00:00:00.1234Z',
      'invalid',
    ])
      expect(isTimestamp(value)).toBe(false);
  });
});

describe('write validation and canonical intent', () => {
  it('matches hand-authored canonical text and an independently computed SHA-256 fixture', () => {
    const value = intent();
    expect(value.canonicalRequestJson).toBe(
      '{"catalogueVersion":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","dashboard":{"state":{"dashboardEntries":[]},"version":10},"expectedAccountWorkspaceId":"00000000-0000-4000-8000-000000000001","expectedRevision":"0","requestId":"00000000-0000-4000-8000-000000000002","transportVersion":1}',
    );
    // Independently computed with Python hashlib over the literal text above.
    expect(value.requestDigest).toBe(
      '0160a21e45eaca20fcd1eaa8d0c5b12062b3d774a77077e74b3399da1fc1455c',
    );
    expect(value.canonicalDashboardJson).toBe('{"state":{"dashboardEntries":[]},"version":10}');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.request.dashboard.state.dashboardEntries)).toBe(true);
  });
  it.each([
    [null, 'INVALID_DASHBOARD_REQUEST'],
    [{ ...envelope(), unknown: true }, 'INVALID_DASHBOARD_REQUEST'],
    [{ ...envelope(), transportVersion: '1' }, 'INVALID_DASHBOARD_REQUEST'],
    [{ ...envelope(), transportVersion: 2 }, 'UNSUPPORTED_TRANSPORT_VERSION'],
    [{ ...envelope(), expectedRevision: '01' }, 'INVALID_DASHBOARD_REQUEST'],
    [{ ...envelope(), requestId: 'bad' }, 'INVALID_DASHBOARD_REQUEST'],
    [{ ...envelope(), catalogueVersion: 'bad' }, 'INVALID_DASHBOARD_REQUEST'],
    [{ ...envelope(), dashboard: { version: 9, state: {} } }, 'UNSUPPORTED_DASHBOARD_VERSION'],
    [{ ...envelope(), dashboard: { version: 11, state: {} } }, 'UNSUPPORTED_DASHBOARD_VERSION'],
    [
      { ...envelope(), dashboard: { version: 10, state: {}, extra: 1 } },
      'INVALID_DASHBOARD_REQUEST',
    ],
    [
      {
        ...envelope(),
        dashboard: { version: 10, state: { dashboardEntries: [], customTrainingSets: [] } },
      },
      'INVALID_DASHBOARD',
    ],
    [{ ...envelope(), expectedAccountWorkspaceId: REQUEST_ID }, 'ACCOUNT_WORKSPACE_MISMATCH'],
  ])('rejects invalid envelope with %s', (value, error) =>
    expect(validate(value)).toEqual({ status: 'invalid', error }),
  );
  it('normalizes lexical equivalents and includes all envelope metadata in equality', () => {
    const original = intent();
    const equivalent = parseStrictJsonText(
      JSON.stringify(envelope())
        .replace('"transportVersion":1', '"transportVersion":1e0')
        .replace('"dashboardEntries"', '"\\u0064ashboardEntries"'),
    );
    expect(intent(equivalent).requestDigest).toBe(original.requestDigest);
    for (const patch of [
      { expectedRevision: '1' },
      { requestId: '00000000-0000-4000-8000-000000000003' },
      { catalogueVersion: 'b'.repeat(64) },
    ])
      expect(intent({ ...envelope(), ...patch }).requestDigest).not.toBe(original.requestDigest);
  });
  it('does not apply current catalogue compatibility while establishing structural intent', () => {
    const catalogue = createDashboardCatalogue([]);
    const accepted = intent();
    expect(catalogue.isCompatible(accepted)).toBe(false);
    const current = intent({ ...envelope(), catalogueVersion: catalogue.version });
    expect(catalogue.isCompatible(current)).toBe(true);
    expect(catalogue.version).toBe(
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    );
  });
});

describe('persistence output validation', () => {
  it('preserves original acknowledgement but rejects corrupt and substituted output', () => {
    const validated = intent();
    const ack = {
      transportVersion: 1,
      accountWorkspaceId: USER_ID,
      requestId: REQUEST_ID,
      revision: '1',
      updatedAt: TIMESTAMP,
    };
    expect(validateDashboardAcknowledgement(ack, validated)).toEqual(ack);
    for (const patch of [
      { revision: '0' },
      { revision: '2' },
      { accountWorkspaceId: REQUEST_ID },
      { requestId: USER_ID },
      { updatedAt: 'invalid' },
      { extra: 1 },
    ])
      expect(validateDashboardAcknowledgement({ ...ack, ...patch }, validated)).toBeNull();
  });
  it('distinguishes absent dashboard from positive-revision saved-empty dashboard', () => {
    if (!isAccountWorkspaceId(USER_ID)) throw new Error('BAD_FIXTURE');
    const catalogue = createDashboardCatalogue([]);
    const empty = {
      transportVersion: 1,
      accountWorkspaceId: USER_ID,
      catalogueVersion: catalogue.version,
      revision: '0',
      dashboard: null,
      updatedAt: null,
    };
    const savedEmpty = {
      ...empty,
      revision: '1',
      dashboard: envelope().dashboard,
      updatedAt: TIMESTAMP,
    };
    expect(catalogue.validateRead(empty, USER_ID)).toEqual(empty);
    expect(catalogue.validateRead(savedEmpty, USER_ID)).toEqual(savedEmpty);
    for (const patch of [
      { dashboard: envelope().dashboard },
      { updatedAt: TIMESTAMP },
      { revision: '1' },
      { accountWorkspaceId: REQUEST_ID },
      { catalogueVersion: CATALOGUE },
      { unexpected: true },
    ])
      expect(catalogue.validateRead({ ...empty, ...patch }, USER_ID)).toBeNull();
  });
});
