// Cross-browser note: this spec runs against whatever projects are defined in
// playwright.config.ts (chromium / webkit / firefox) — no browser is hardcoded here.
// WebKit-desktop is the closest available proxy for iOS Safari's video decoding
// quirks, but it does NOT replace a real-device check of the decoder-priming fix
// (iOS Safari has device-specific autoplay/seek/decoder behavior Playwright's
// WebKit build does not fully reproduce).

import { test, expect, type Page } from '@playwright/test';

type Pause = { idx: number; t: number; scrollY: number; progress: number };
type Transit = { scrollY: number; progress: number };
type Scrub = {
  ready: boolean;
  duration: number;
  pauses: Pause[];
  transits: Transit[];
  stStart: number;
  stEnd: number;
  endVH: number;
};

const TOLERANCE = 1 / 30 + 0.06; // one frame @30fps + settle slop
const SETTLE_MS = 400;

async function gotoReady(page: Page): Promise<Scrub> {
  await page.goto('/index.html');
  await page.locator('#scrub').evaluate((el: HTMLVideoElement) =>
    el.readyState >= 1
      ? Promise.resolve()
      : new Promise<void>((resolve) => el.addEventListener('loadedmetadata', () => resolve(), { once: true }))
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => (window as any).__scrub && (window as any).__scrub.ready);
  return page.evaluate(() => (window as any).__scrub as Scrub);
}

async function scrollAndSettle(page: Page, y: number) {
  await page.evaluate((targetY) => window.scrollTo(0, targetY), y);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  await page.waitForTimeout(SETTLE_MS);
}

async function opacityOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).opacity));
}

const viewports: [number, number][] = [
  [320, 568],
  [360, 740],
  [390, 844],
  [414, 896],
  [768, 1024],
  [834, 1112],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
  [740, 360], // landscape phone
];

for (const [width, height] of viewports) {
  test.describe(`viewport ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test(`pause accuracy + overlays @${width}x${height}`, async ({ page }) => {
      const scrub = await gotoReady(page);

      // 2. Pause-trigger accuracy
      for (const pause of scrub.pauses) {
        await scrollAndSettle(page, pause.scrollY);
        const currentTime = await page.locator('#scrub').evaluate((el: HTMLVideoElement) => el.currentTime);
        expect(Math.abs(currentTime - pause.t)).toBeLessThanOrEqual(TOLERANCE);
        await expect(page).toHaveScreenshot(`pause-${pause.idx}-w${width}.png`, { maxDiffPixelRatio: 0.02 });
      }

      // 3. Scrub-bound determinism: back to top, then re-visit same positions
      await scrollAndSettle(page, 0);
      for (const pause of scrub.pauses) {
        await scrollAndSettle(page, pause.scrollY);
        const currentTime = await page.locator('#scrub').evaluate((el: HTMLVideoElement) => el.currentTime);
        expect(Math.abs(currentTime - pause.t)).toBeLessThanOrEqual(TOLERANCE);
        await expect(page).toHaveScreenshot(`pause-${pause.idx}-w${width}.png`, { maxDiffPixelRatio: 0.02 });
      }

      // 4. Overlay timing at pause midpoints
      for (const pause of scrub.pauses) {
        await scrollAndSettle(page, pause.scrollY);
        const opacity = await opacityOf(page, `#ov${pause.idx + 1}`);
        expect(opacity).toBeGreaterThanOrEqual(0.9);
      }

      // Overlay timing at transit midpoints: all overlays hidden
      for (const transit of scrub.transits) {
        await scrollAndSettle(page, transit.scrollY);
        for (const ovId of ['#ov1', '#ov2', '#ov3', '#ov4']) {
          const opacity = await opacityOf(page, ovId);
          expect(opacity).toBeLessThanOrEqual(0.1);
        }
      }
    });

    // 5. Responsive sweep: no horizontal overflow, CTAs hit-testable
    test(`responsive layout @${width}x${height}`, async ({ page }) => {
      await gotoReady(page);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

      for (const selector of ['.nav-cta', '#ov1 .btn']) {
        const el = page.locator(selector).first();
        await expect(el).toBeVisible();
        const box = await el.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
