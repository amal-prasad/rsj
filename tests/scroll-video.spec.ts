// Cross-browser note: this spec runs against whatever projects are defined in
// playwright.config.ts (chromium / webkit / firefox) — no browser is hardcoded here.
// WebKit-desktop is the closest available proxy for iOS Safari's video decoding
// quirks, but it does NOT replace a real-device check of the decoder-priming fix
// (iOS Safari has device-specific autoplay/seek/decoder behavior Playwright's
// WebKit build does not fully reproduce).
//
// Model: the video scrubs CONTINUOUSLY across the whole pin — it never freezes.
// window.__scrub.marks are overlay-timing anchors (video keeps advancing under
// each overlay), not freeze points. So this spec asserts monotonic ct progress
// instead of a fixed currentTime at each mark.

import { test, expect, type Page } from '@playwright/test';

type Mark = { idx: number; t: number; scrollY: number; progress: number };
type Scrub = {
  ready: boolean;
  continuous: boolean;
  duration: number;
  marks: Mark[];
  stStart: number;
  stEnd: number;
  endVH: number;
};

const SETTLE_MS = 400;
const CT_EPS = 0.02; // seconds; floor for "did it actually move"

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

async function currentTimeOf(page: Page): Promise<number> {
  return page.locator('#scrub').evaluate((el: HTMLVideoElement) => el.currentTime);
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

    test(`continuous scrub + overlay timing @${width}x${height}`, async ({ page }) => {
      const scrub = await gotoReady(page);
      expect(scrub.continuous).toBe(true);

      // 1. ct is a monotonically non-decreasing function of scroll — proves the
      // spine is one continuous scrub, not a freeze at each mark.
      let lastCt = -1;
      for (const mark of scrub.marks) {
        await scrollAndSettle(page, mark.scrollY);
        const ct = await currentTimeOf(page);
        expect(ct).toBeGreaterThan(lastCt);
        lastCt = ct;

        // video keeps advancing past the mark under the overlay (no freeze)
        await scrollAndSettle(page, Math.min(mark.scrollY + 140, scrub.stEnd));
        const ctPast = await currentTimeOf(page);
        expect(ctPast - ct).toBeGreaterThan(CT_EPS);
        lastCt = ctPast;
      }

      // 2. Determinism: back to top, then re-visit each mark — ct must match
      // (same scroll position -> same currentTime, proves scroll-bound not event-bound).
      await scrollAndSettle(page, 0);
      for (const mark of scrub.marks) {
        await scrollAndSettle(page, mark.scrollY);
        const ct = await currentTimeOf(page);
        expect(Math.abs(ct - mark.t)).toBeLessThanOrEqual(0.15);
        await expect(page).toHaveScreenshot(`mark-${mark.idx}-w${width}.png`, { maxDiffPixelRatio: 0.02 });
      }

      // 3. Overlay opacity gates correctly at each mark: own overlay up, others down.
      for (const mark of scrub.marks) {
        await scrollAndSettle(page, mark.scrollY);
        for (let i = 0; i < scrub.marks.length; i++) {
          const opacity = await opacityOf(page, `#ov${i + 1}`);
          if (i === mark.idx) expect(opacity).toBeGreaterThanOrEqual(0.9);
          else expect(opacity).toBeLessThanOrEqual(0.1);
        }
      }
    });

    // 4. Responsive sweep: no horizontal overflow, CTAs hit-testable
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
