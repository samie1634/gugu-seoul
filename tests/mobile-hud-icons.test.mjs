import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const mobileStart = css.indexOf('@media (pointer: coarse), (max-width: 700px)');
const mobile = css.slice(mobileStart, css.indexOf('@media (max-width: 360px)'));
const rule = (text, selector) => {
  const start = text.indexOf(selector + ' {'); assert.ok(start >= 0, selector);
  return text.slice(start, text.indexOf('}', start));
};
const pixel = (block, name) => Number(block.match(new RegExp(`(?:^|[;{])\\s*${name}: ([0-9.]+)px`))?.[1]);
const panel = rule(mobile, '.flight-panel');

test('mobile status is anchored at the upper right without the old centered transform', () => {
  assert.match(panel, /left: auto;/); assert.match(panel, /right: max\(15px, env\(safe-area-inset-right\)\)/);
  assert.match(panel, /top: max\(104px, calc\(env\(safe-area-inset-top\) \+ 89px\)\)/);
  assert.match(panel, /bottom: auto;/); assert.match(panel, /transform: none;/);
  assert.match(panel, /min-width: 0;/); assert.match(panel, /max-width: calc\(100vw - 145px - env\(safe-area-inset-right\)\)/);
  const short = css.slice(css.indexOf('@media (pointer: coarse) and (max-height: 520px)'));
  assert.match(short, /top: max\(61px, calc\(env\(safe-area-inset-top\) \+ 46px\)\); bottom: auto;/);
  // Desktop retains the original placement; only mobile rules are changed.
  const desktop = rule(css.slice(0, mobileStart), '.flight-panel');
  assert.match(desktop, /right: 28px; bottom: 29px;/); assert.doesNotMatch(desktop, /top:/);
});

test('three requested actions use distinct icons and retain accessible names and button IDs', () => {
  const paths = [];
  for (const [id, label] of [['peck', '쪼기'], ['flirt', '날개를 위로 모아 플러팅하기'], ['coo', '구구 울기']]) {
    const button = html.match(new RegExp(`<button id="touch-${id}"[^>]*>([\\s\\S]*?)<\\/button>`));
    assert.ok(button, id); assert.match(button[0], /type="button"/);
    assert.ok(button[0].includes(`aria-label="${label}"`)); assert.match(button[0], /title="[^"]+"/);
    assert.match(button[1], /<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">/);
    assert.equal(button[1].replace(/<[^>]*>/g, '').trim(), '', 'icons have no duplicated visible text');
    paths.push(button[1]);
    const layout = rule(mobile, `.touch-${id}`);
    assert.ok(pixel(layout, 'width') >= 44 && pixel(layout, 'height') >= 44, '44px touch target');
  }
  assert.equal(new Set(paths).size, 3);
  assert.match(css, /\.touch-peck svg, \.touch-flirt svg, \.touch-coo svg[^}]*pointer-events: none;/);
  for (const id of ['flight-state', 'next-look', 'altitude', 'speed']) assert.ok(html.includes(`id="${id}"`), 'all status content retained');
  assert.match(rule(css, '.flight-panel'), /pointer-events: none/);
});

// Analytic CSS box budget, not rendered browser/device evidence. Explicitly
// budget text lines conservatively and verify safe-area and touch separations.
const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const screens = [
  [320, 568, 0, 0, 0], [320, 480, 0, 0, 0], [360, 640, 0, 0, 0],
  [390, 844, 47, 34, 0], [430, 932, 59, 34, 0], [768, 1024, 24, 20, 0],
  [568, 320, 0, 21, 44], [667, 375, 0, 0, 0], [844, 390, 0, 21, 47],
];
for (const [width, height, safeTop, safeBottom, safeRight] of screens) {
  test(`analytic mobile HUD and touch boxes remain separate at ${width}x${height}`, () => {
    const compact = height <= 400 && width >= 480;
    const compactCss = css.slice(css.indexOf('@media (pointer: coarse) and (max-height: 400px)'));
    const w = Math.min(pixel(compact ? rule(compactCss, '.flight-panel') : panel, 'width'), width - 145 - safeRight);
    const hud = { x: width - Math.max(15, safeRight) - w,
      y: height <= 520 ? Math.max(61, safeTop + 46) : Math.max(104, safeTop + 89),
      w, h: compact ? 46 : 78 };
    assert.ok(hud.x >= 0 && hud.y >= safeTop && hud.y + hud.h <= height - safeBottom);
    const map = { x: 15, y: Math.max(66, safeTop + 51), w: height <= 520 ? 90 : 103, h: 122 };
    assert.equal(intersects(hud, map), false, 'status does not cover minimap');
    const joystick = { x: 22, y: height - safeBottom - 28 - (width <= 360 ? 110 : 122), w: width <= 360 ? 110 : 122, h: width <= 360 ? 110 : 122 };
    const actions = ['peck', 'flirt', 'coo'].map(id => {
      const s = rule(mobile, `.touch-${id}`);
      return { x: width - pixel(s, 'right') - pixel(s, 'width'), y: height - safeBottom - pixel(s, 'bottom') - pixel(s, 'height'), w: pixel(s, 'width'), h: pixel(s, 'height') };
    });
    for (const box of actions) {
      assert.equal(intersects(hud, box), false, 'status does not cover action');
      assert.equal(intersects(joystick, box), false, 'action does not cover joystick');
    }
    for (let a = 0; a < actions.length; a++) for (let b = a + 1; b < actions.length; b++) assert.equal(intersects(actions[a], actions[b]), false);
    assert.equal(intersects(hud, { x: width / 2 - 20, y: height / 2 - 20, w: 40, h: 40 }), false, 'center is clear');
  });
}
