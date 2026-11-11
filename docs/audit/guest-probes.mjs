/* global DOMException, Storage, TextEncoder, URL, localStorage, process, sessionStorage */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '../../apps/web/node_modules/@playwright/test/index.mjs';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';
import { COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY } from '../../apps/web/src/lib/cookie-notice.ts';
import {
  classifyTrainingStorageValue,
  createTrainingStore,
} from '../../packages/store/src/index.ts';

const baseURL = 'http://127.0.0.1:4173';
const key = 'kendo-menu';
const cap = 2_097_152;
const dashboard = '/app/guest/dashboard';

function fixture() {
  return {
    version: 11,
    state: {
      dashboardEntries: [
        {
          id: 'audit-entry',
          trainingSetId: 'audit-menu',
          trainingSet: {
            id: 'audit-menu',
            name: 'Audit 稽古',
            category: 'custom',
            isBuiltIn: false,
            sections: [{ id: 'audit-activity', name: 'Practice', exercises: [] }],
          },
          notes: '',
          createdAt: '2026-10-22T12:00:00.000Z',
          activityNotes: {},
          quantityOverrides: {},
        },
      ],
    },
  };
}

function nearLimit(length) {
  const envelope = fixture();
  const sections = envelope.state.dashboardEntries[0].trainingSet.sections;
  let remaining = length - JSON.stringify(envelope).length;
  for (let i = 0; remaining > 0; i += 1) {
    if (i % 100 === 0) {
      sections.push({ id: `section-${i}`, name: `Group ${i}`, exercises: [] });
    }
    const exercises = sections.at(-1).exercises;
    const exercise = { id: `exercise-${i}`, name: `Exercise ${i}`, notes: '' };
    exercises.push(exercise);
    remaining = length - JSON.stringify(envelope).length;
    assert(remaining >= 0);
    exercise.notes = 'x'.repeat(Math.min(8_000, remaining));
    remaining -= exercise.notes.length;
  }
  return JSON.stringify(envelope);
}

const edge = nearLimit(cap - 1);
assert.equal(edge.length, cap - 1);
assert(new TextEncoder().encode(edge).byteLength > edge.length);
for (const [raw, status] of [
  [edge, 'ready'],
  [edge + ' ', 'ready'],
  [edge + '  ', 'corrupt'],
]) {
  assert.equal(classifyTrainingStorageValue(raw).status, status);
}
let durable = nearLimit(cap - 8);
const original = durable;
const store = createTrainingStore({
  storage: {
    getItem: () => durable,
    setItem: (_key, value) => {
      durable = value;
    },
    removeItem: () => {
      durable = null;
    },
  },
});
assert.throws(
  () => store.getState().updateDashboardEntry('audit-entry', { notes: 'Not saved, audit.' }),
  /2097152 characters/,
);
assert.equal(store.getState().dashboardEntries[0].notes, '');
assert.equal(durable, original);
process.stdout.write(
  'Limits: accepts 2097151 and 2097152 code units; rejects 2097153 and preserves state on overflow.\n',
);

process.env.VITE_NEON_AUTH_URL = 'https://synthetic-auth.example.invalid/neon/auth';
const server = await createServer({
  root: fileURLToPath(new URL('../../apps/web/', import.meta.url)),
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
let browser;
async function isolate(run) {
  const context = await browser.newContext({ baseURL });
  context.setDefaultTimeout(7_500);
  await context.addInitScript((name) => {
    localStorage.setItem(name, String(Date.now() + 60_000));
  }, COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY);
  const menuApi = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL) {
      if (/^\/api\/(dashboard|shares)(?:\/|$)/u.test(url.pathname)) {
        menuApi.push(route.request().method());
        return route.abort();
      }
      return route.continue();
    }
    return route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
  });
  try {
    await run(context);
    assert.deepEqual(menuApi, []);
  } finally {
    await context.close();
  }
}

const read = (page) => page.evaluate((key) => localStorage.getItem(key), key);

async function open(page, path = dashboard) {
  await page.goto(path);
}
async function seed(page, raw) {
  await open(page);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
  await page.reload();
}
async function curated(page, id) {
  await open(page, `/app/guest/library?drill=${id}`);
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  return page.getByRole('dialog').locator('.inline-confirmation');
}
async function menu(page) {
  await page.getByRole('button', { name: 'View more' }).click();
  return page.getByRole('dialog', { name: 'Audit 稽古' });
}

try {
  await server.listen();
  browser = await chromium.launch();
  await isolate(async (context) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await open(a, '/app/guest/library?drill=junior-high-kendo-club');
    await expect(a.getByRole('button', { name: 'Add to dashboard' })).toBeVisible();
    await expect(await curated(b, 'senior-high-school-kendo-club')).toContainText(
      'added to your dashboard.',
    );
    const bSaved = await read(b);
    assert.match(bSaved, /senior-high-school-kendo-club/u);

    await a.getByRole('button', { name: 'Add to dashboard' }).click();
    const aDetails = a.getByRole('dialog');
    await expect(aDetails.locator('.inline-confirmation')).toContainText(
      'could not confirm it was saved',
    );
    await aDetails.getByRole('link', { name: 'View dashboard' }).click();
    await expect(a.getByRole('heading', { name: 'Changes are not saved' })).toBeVisible();
    assert.equal(await read(a), bSaved);

    await a.getByRole('button', { name: 'Open recovery options' }).click();
    await a.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => read(b)).toMatch(/junior-high-kendo-club/u);
    assert.doesNotMatch(await read(b), /senior-high-school-kendo-club/u);
    await b.reload();
    await expect(b.getByRole('heading', { name: 'Senior High School dojo menu' })).toHaveCount(0);
    process.stdout.write('KM-01-001 reproduced: stale tab retry replaces peer-confirmed menu.\n');
  });

  await isolate(async (context) => {
    await context.addInitScript((key) => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key && sessionStorage.getItem('audit-quota') === '1')
          throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
        return setItem.call(this, name, value);
      };
    }, key);
    const page = await context.newPage();
    await open(page, '/app/guest/drills/new');
    await page.getByLabel('Session name').fill('Audit 稽古');
    await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
    await page.getByLabel('Exercise name').fill('Suburi');
    await page.getByLabel('Repetitions', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Save session to dashboard' }).click();
    await expect(page).toHaveURL(baseURL + dashboard);
    const created = JSON.parse(await read(page));
    assert.equal(created.version, 11);
    assert.equal(
      created.state.dashboardEntries[0].trainingSet.sections[0].quantities.repetitions,
      0,
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Audit 稽古' })).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem('audit-quota', '1'));
    await page.getByRole('button', { name: /remove/i }).click();
    await expect(page.getByRole('heading', { name: 'Changes are not saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Open recovery options' }).click();
    await page.getByRole('button', { name: 'Reset local data' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset local data' }).click();
    await expect.poll(() => read(page)).toBeNull();
    await page.evaluate(() => sessionStorage.removeItem('audit-quota'));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => read(page)).toMatch(/Audit 稽古/u);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Audit 稽古' })).toBeVisible();
    process.stdout.write('KM-01-002 reproduced: pre-reset Undo restores erased custom menu.\n');
  });

  await isolate(async (context) => {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await seed(page, original);
    const dialog = await menu(page);
    await dialog.getByLabel('Practice notes').fill('Not saved, audit.');
    await dialog.getByRole('button', { name: 'Save your changes' }).click();
    await expect(dialog.getByText('Changes saved on this device.')).toBeVisible();
    assert(pageErrors.some((message) => message.includes('2097152 characters')));
    assert.equal(await read(page), original);
    await page.reload();
    await expect((await menu(page)).getByLabel('Practice notes')).toHaveValue('');
    process.stdout.write(
      'KM-01-003 reproduced: near-limit note is rejected but the dialog reports a save.\n',
    );
  });
} finally {
  await browser?.close();
  await server.close();
}
