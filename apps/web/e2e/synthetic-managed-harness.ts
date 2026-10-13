import type { Page, Request, Route } from '@playwright/test';

export const SYNTHETIC_AUTH_URL = 'https://synthetic-auth.example.invalid/neon/auth';
export const SYNTHETIC_TOKEN = 'synthetic-browser-token';
export const SYNTHETIC_SESSION_TOKEN = 'synthetic-session-credential';
export const ACCOUNT_ID = '01234567-89ab-4cde-8fab-0123456789ab';
export const OTHER_ACCOUNT_ID = '01234567-89ab-4cde-8fab-0123456789ac';
export const CATALOGUE_VERSION = 'a'.repeat(64);
export const COPY_OPPORTUNITY_ID = '01234567-89ab-4cde-8fab-0123456789ad';

export interface SyntheticApiCall {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly cookie: string | undefined;
  readonly body: string | undefined;
}

export interface SyntheticManagedOptions {
  readonly initiallySignedIn?: boolean;
  readonly initiallyUninitialized?: boolean;
  readonly dashboard?: unknown;
  readonly accountId?: string;
  readonly email?: string | null;
  readonly createdAccount?: boolean;
  readonly copyOpportunityId?: string | null;
}

interface HeldSave {
  readonly observed: Promise<SyntheticApiCall>;
  readonly respond: (response?: { readonly status: number; readonly body: unknown }) => void;
}

interface SaveGate {
  readonly observed: (call: SyntheticApiCall) => void;
  readonly response: Promise<{ readonly status: number; readonly body: unknown }>;
  readonly respond: (response: { readonly status: number; readonly body: unknown }) => void;
}

interface AdoptionGate {
  readonly observed: (call: SyntheticApiCall) => void;
  readonly response: Promise<{ readonly status: number; readonly body: unknown }>;
  readonly respond: (response: { readonly status: number; readonly body: unknown }) => void;
}

interface HeldAdoption {
  readonly observed: Promise<SyntheticApiCall>;
  readonly respond: (response?: { readonly status: number; readonly body: unknown }) => void;
}

function jsonResponse(status: number, body: unknown): Parameters<Route['fulfill']>[0] {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function callFromRequest(request: Request): SyntheticApiCall {
  const url = new URL(request.url());
  const headers = request.headers();
  return {
    method: request.method(),
    path: `${url.pathname}${url.search}`,
    authorization: headers['authorization'],
    cookie: headers['cookie'],
    body: request.postData() ?? undefined,
  };
}

/** Browser-only fake managed transport and Migration B HTTP contract. */
export class SyntheticManagedHarness {
  readonly apiCalls: SyntheticApiCall[] = [];
  readonly authCalls: string[] = [];
  private signedIn: boolean;
  private accountId: string;
  private email: string | null;
  private initialized: boolean;
  private revision = '0';
  private dashboard: unknown;
  private failNextSave = false;
  private conflictNextSave = false;
  private dashboardUnavailable = false;
  private accountUnavailable = false;
  private unauthorizedNextSave = false;
  private saveGate: SaveGate | null = null;
  private adoptionGate: AdoptionGate | null = null;
  private createdAccount: boolean;
  private copyOpportunityId: string | null;
  private opportunityAvailable = true;

  private constructor(options: SyntheticManagedOptions) {
    this.signedIn = options.initiallySignedIn ?? false;
    this.accountId = options.accountId ?? ACCOUNT_ID;
    this.email = options.email ?? 'practitioner@example.test';
    this.initialized = !(options.initiallyUninitialized ?? false);
    this.dashboard = options.dashboard ?? null;
    this.createdAccount = options.createdAccount ?? true;
    this.copyOpportunityId =
      options.copyOpportunityId === undefined ? COPY_OPPORTUNITY_ID : options.copyOpportunityId;
  }

  static async install(
    page: Page,
    options: SyntheticManagedOptions = {},
  ): Promise<SyntheticManagedHarness> {
    const harness = new SyntheticManagedHarness(options);
    await page.route(`${SYNTHETIC_AUTH_URL}/**`, (route) => harness.handleAuth(route));
    await page.route('**/api/**', (route) => harness.handleApi(route));
    return harness;
  }

  setAccountUnavailable(value: boolean): void {
    this.accountUnavailable = value;
  }

  setDashboardUnavailable(value: boolean): void {
    this.dashboardUnavailable = value;
  }

  setAccountId(value: string): void {
    this.accountId = value;
    this.revision = '0';
    this.dashboard = null;
  }

  setDashboard(dashboard: unknown, revision: string): void {
    this.dashboard = dashboard;
    this.revision = revision;
  }

  setSignedIn(value: boolean): void {
    this.signedIn = value;
  }

  failOneSave(): void {
    this.failNextSave = true;
  }

  unauthorizeOneSave(): void {
    this.unauthorizedNextSave = true;
  }

  conflictOneSave(): void {
    this.conflictNextSave = true;
  }

  holdNextAdoption(): HeldAdoption {
    let observeRequest: ((call: SyntheticApiCall) => void) | undefined;
    let resolveResponse:
      ((response: { readonly status: number; readonly body: unknown }) => void) | undefined;
    const observedPromise = new Promise<SyntheticApiCall>((resolve) => {
      observeRequest = resolve;
    });
    const responsePromise = new Promise<{ readonly status: number; readonly body: unknown }>(
      (resolve) => {
        resolveResponse = resolve;
      },
    );
    this.adoptionGate = {
      observed: (call) => observeRequest?.(call),
      response: responsePromise,
      respond: (response) => resolveResponse?.(response),
    };
    return {
      observed: observedPromise,
      respond: (response = { status: 200, body: null }) => resolveResponse?.(response),
    };
  }

  setCopyOpportunityAvailable(value: boolean): void {
    this.opportunityAvailable = value;
  }

  holdNextSave(): HeldSave {
    let observeRequest: ((call: SyntheticApiCall) => void) | undefined;
    let resolveResponse:
      ((response: { readonly status: number; readonly body: unknown }) => void) | undefined;
    const observedPromise = new Promise<SyntheticApiCall>((resolve) => {
      observeRequest = resolve;
    });
    const responsePromise = new Promise<{ readonly status: number; readonly body: unknown }>(
      (resolve) => {
        resolveResponse = resolve;
      },
    );
    this.saveGate = {
      observed: (call) => observeRequest?.(call),
      response: responsePromise,
      respond: (response) => resolveResponse?.(response),
    };
    return {
      observed: observedPromise,
      respond: (response = { status: 200, body: null }) => resolveResponse?.(response),
    };
  }

  async authenticateFromLanding(page: Page): Promise<void> {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Sign up here' }).click();
    await page.waitForURL(/\/app\/account\/dashboard$/);
  }

  private async handleAuth(route: Route): Promise<void> {
    const url = route.request().url();
    this.authCalls.push(url);
    if (url.includes('/sign-in/social')) {
      const headers = route.request().headers();
      const applicationOrigin =
        headers['origin'] ??
        (headers['referer'] === undefined ? undefined : new URL(headers['referer']).origin);
      if (applicationOrigin === undefined) {
        await route.fulfill({ status: 400, json: { message: 'Missing browser origin.' } });
        return;
      }
      await route.fulfill({
        json: {
          redirect: true,
          url: new URL('/?neon_auth_session_verifier=synthetic-verifier', applicationOrigin).href,
        },
        headers: {
          'set-cookie':
            'synthetic-challenge=synthetic-challenge-cookie; Path=/neon/auth; HttpOnly; Secure; SameSite=None',
        },
      });
      return;
    }
    if (url.includes('/get-session')) {
      this.signedIn = true;
      await route.fulfill({
        json: {
          session: { token: SYNTHETIC_SESSION_TOKEN },
          user: { id: 'synthetic-subject', email: this.email },
        },
        headers: {
          'set-cookie':
            'synthetic-managed-session=synthetic-session-cookie; Path=/neon/auth; HttpOnly; Secure; SameSite=None',
        },
      });
      return;
    }
    if (url.includes('/sign-out')) {
      this.signedIn = false;
      await route.fulfill({
        json: { success: true },
        headers: {
          'set-cookie':
            'synthetic-managed-session=; Path=/neon/auth; HttpOnly; Secure; SameSite=None; Max-Age=0',
        },
      });
      return;
    }
    if (url.endsWith('/token')) {
      await route.fulfill(
        this.signedIn
          ? { json: { token: SYNTHETIC_TOKEN } }
          : { status: 401, json: { message: 'Unauthenticated' } },
      );
      return;
    }
    await route.fulfill({ status: 404, json: { message: 'Synthetic auth route not found.' } });
  }

  private async handleApi(route: Route): Promise<void> {
    const call = callFromRequest(route.request());
    this.apiCalls.push(call);
    const { pathname } = new URL(route.request().url());
    if (!this.signedIn) {
      await route.fulfill(jsonResponse(401, { error: 'UNAUTHENTICATED' }));
      return;
    }
    if (pathname === '/api/account' && this.accountUnavailable) {
      await route.fulfill(jsonResponse(503, { error: 'SERVICE_UNAVAILABLE' }));
      return;
    }
    if (pathname === '/api/account' && route.request().method() === 'GET') {
      if (!this.initialized) {
        await route.fulfill(jsonResponse(409, { error: 'ACCOUNT_NOT_INITIALIZED' }));
        return;
      }
      await route.fulfill(jsonResponse(200, { accountId: this.accountId, email: this.email }));
      return;
    }
    if (pathname === '/api/account' && route.request().method() === 'POST') {
      this.initialized = true;
      await route.fulfill(
        jsonResponse(200, {
          accountId: this.accountId,
          email: this.email,
          created: this.createdAccount,
          ...(this.createdAccount && this.copyOpportunityId !== null
            ? { copyOpportunityId: this.copyOpportunityId }
            : {}),
        }),
      );
      return;
    }
    if (pathname === '/api/dashboard/adoption' && route.request().method() === 'POST') {
      if (this.adoptionGate !== null) {
        const gate = this.adoptionGate;
        this.adoptionGate = null;
        gate.observed(call);
        const reply = await gate.response;
        if (reply.status === 200 || reply.status === 0) this.completeAdoption(call);
        if (reply.status === 0) {
          await route.abort('failed').catch(() => undefined);
          return;
        }
        await route.fulfill(jsonResponse(reply.status, reply.body)).catch(() => undefined);
        return;
      }
      if (!this.opportunityAvailable || this.revision !== '0' || this.dashboard !== null) {
        await route.fulfill(jsonResponse(409, { error: 'COPY_OPPORTUNITY_UNAVAILABLE' }));
        return;
      }
      this.completeAdoption(call);
      const request = this.adoptionRequest(call);
      const requestId = request?.['requestId'];
      if (request?.['decision'] === 'no') {
        await route.fulfill(
          jsonResponse(200, {
            status: 'declined',
            completion: { decision: 'no', requestId },
          }),
        );
      } else {
        await route.fulfill(
          jsonResponse(200, {
            status: 'accepted',
            completion: {
              decision: 'yes',
              requestId,
              acknowledgedRevision: this.revision,
              timestamp: '2026-10-07T10:00:00.000Z',
            },
            acknowledgement: this.writeAck(call),
          }),
        );
      }
      return;
    }
    if (pathname === '/api/dashboard' && route.request().method() === 'GET') {
      if (this.dashboardUnavailable) {
        await route.fulfill(jsonResponse(503, { error: 'SERVICE_UNAVAILABLE' }));
        return;
      }
      await route.fulfill(
        jsonResponse(200, {
          transportVersion: 1,
          accountWorkspaceId: this.accountId,
          catalogueVersion: CATALOGUE_VERSION,
          revision: this.revision,
          dashboard: this.dashboard,
          updatedAt: this.revision === '0' ? null : '2026-10-07T10:00:00.000Z',
        }),
      );
      return;
    }
    if (pathname === '/api/dashboard' && route.request().method() === 'PUT') {
      if (this.unauthorizedNextSave) {
        this.unauthorizedNextSave = false;
        await route.fulfill(jsonResponse(401, { error: 'UNAUTHENTICATED' }));
        return;
      }
      if (this.saveGate !== null) {
        const gate = this.saveGate;
        this.saveGate = null;
        gate.observed(call);
        const reply = await gate.response;
        if (reply.status === 200) {
          const body = typeof call.body === 'string' ? (JSON.parse(call.body) as unknown) : null;
          this.dashboard =
            body !== null && typeof body === 'object' && 'dashboard' in body
              ? body.dashboard
              : this.dashboard;
          this.revision = String(Number(this.revision) + 1);
          await route.fulfill(jsonResponse(200, this.writeAck(call))).catch(() => undefined);
        } else {
          await route.fulfill(jsonResponse(reply.status, reply.body)).catch(() => undefined);
        }
        return;
      }
      if (this.failNextSave) {
        this.failNextSave = false;
        await route.fulfill(jsonResponse(503, { error: 'SERVICE_UNAVAILABLE' }));
        return;
      }
      if (this.conflictNextSave) {
        this.conflictNextSave = false;
        await route.fulfill(
          jsonResponse(409, { error: 'REVISION_CONFLICT', currentRevision: this.revision }),
        );
        return;
      }
      const body = route.request().postData();
      if (body !== null) {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === 'object' && parsed !== null && 'dashboard' in parsed) {
          this.dashboard = parsed.dashboard;
        }
      }
      this.revision = String(Number(this.revision) + 1);
      await route.fulfill(jsonResponse(200, this.writeAck(call)));
      return;
    }
    await route.fulfill(jsonResponse(404, { error: 'NOT_FOUND' }));
  }

  private writeAck(call: SyntheticApiCall): unknown {
    let requestId: unknown = null;
    if (typeof call.body === 'string') {
      const parsed: unknown = JSON.parse(call.body);
      if (typeof parsed === 'object' && parsed !== null && 'requestId' in parsed) {
        requestId = parsed.requestId;
      }
    }
    return {
      transportVersion: 1,
      accountWorkspaceId: this.accountId,
      requestId,
      revision: this.revision,
      updatedAt: '2026-10-07T10:00:00.000Z',
    };
  }

  private adoptionRequest(call: SyntheticApiCall): Record<string, unknown> | null {
    if (typeof call.body !== 'string') return null;
    const parsed: unknown = JSON.parse(call.body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  }

  private completeAdoption(call: SyntheticApiCall): void {
    if (!this.opportunityAvailable || this.revision !== '0' || this.dashboard !== null) return;
    const request = this.adoptionRequest(call);
    if (
      request?.['decision'] === 'yes' &&
      typeof request['dashboard'] === 'object' &&
      request['dashboard'] !== null
    ) {
      this.dashboard = request['dashboard'];
      this.revision = '1';
    }
    this.opportunityAvailable = false;
  }
}
