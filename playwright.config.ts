import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de ponta a ponta. Rodam contra a aplicação compilada, em modo local
 * (sem servidor), o que cobre a interface, o salvamento automático, a
 * sincronização entre abas e a geração de PDF.
 *
 * PLAYWRIGHT_CHROMIUM_PATH permite usar um Chromium já instalado no sistema.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/AgitarCanvas/`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { executablePath } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true, launchOptions: { executablePath } },
      grep: /@responsivo/,
    },
    {
      name: 'celular',
      use: { ...devices['Pixel 7'], launchOptions: { executablePath } },
      grep: /@responsivo/,
    },
    {
      // Motor do Safari. Requer "npx playwright install webkit".
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /@responsivo|@essencial/,
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/AgitarCanvas/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
