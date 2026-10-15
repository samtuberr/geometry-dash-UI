import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Exercise the built container, including nginx, MIME types and SPA routing.
export default defineConfig({
  ...base,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { ...base.use, baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080', trace: 'retain-on-failure' },
  webServer: undefined,
});
