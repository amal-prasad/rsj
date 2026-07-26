// Self-check for lingerEase (copied from scrub-engine.js): seam frames must stay
// put and the curve must never reverse — a dip would show up as the video running
// backwards mid-scene. Run: node test-linger.mjs
import assert from 'node:assert';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lingerEase = (x, L) => { L = clamp(L); const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };

const Ls = [0, 0.25, 0.5, 1];

for (const L of Ls) {
  assert.strictEqual(lingerEase(0, L), 0, `lingerEase(0, ${L}) should be 0`);
  assert.strictEqual(lingerEase(1, L), 1, `lingerEase(1, ${L}) should be 1`);

  let prev = -Infinity;
  for (let i = 0; i < 200; i++) {
    const x = i / 199;
    const y = lingerEase(x, L);
    assert.ok(y >= prev - 1e-9, `not monotonic at x=${x}, L=${L}: ${y} < ${prev}`);
    prev = y;
  }
}

console.log(`lingerEase: seam frames untouched + monotonic across ${Ls.length} linger values (200 samples each). OK`);
