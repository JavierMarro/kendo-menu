import { test as base } from '@playwright/test';

// Every browser suite uses synthetic managed transport. Individual account tests override this route.
export const test = base.extend<{ anonymousAuth: void }>({
  anonymousAuth: [
    async ({ context }, use) => {
      await context.route('https://synthetic-auth.example.invalid/**', (route) =>
        route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
      );
      await use();
    },
    { auto: true },
  ],
});
