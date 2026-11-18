import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1200, height: 900 },
        deviceScaleFactor: 1,
        // Greyscale text: where the system turns on subpixel (LCD) text, as on GitHub's Ubuntu runners,
        // glyph edges get red and blue fringes that the pixel tests would count as border ink.
        launchOptions: { args: ['--disable-lcd-text'] },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 } },
  ],
});
