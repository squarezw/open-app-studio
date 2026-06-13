import { describe, expect, it } from 'vitest';
import type { DeviceDriver } from '@oas/device-bridge';
import type { Point, UiNode } from '@oas/flow-graph';
import { runDeviceBenchmark } from '../src/benchmark.js';

/** A device with one text field that correctly replaces on clearText (the good case). */
function goodDriver() {
  let value = 'Label *';
  let kb = false;
  const tree = (): UiNode => ({
    className: 'screen.form',
    bounds: { x: 0, y: 0, w: 1080, h: 2400 },
    children: [
      { className: 'android.widget.EditText', resourceId: 'com.x:id/in', text: value, focusable: true, clickable: true, enabled: true, bounds: { x: 0, y: 200, w: 1080, h: 120 }, children: [] },
    ],
  });
  const d: DeviceDriver = {
    async launch() {}, async uiTree() { return tree(); },
    async tap(p: Point) { kb = p.y > 150 && p.y < 360; },
    async type(t: string) { value += t; }, // append (real device behavior)
    async clearText() { value = ''; }, // clearText replaces — correct
    async pressEnter() {},
    async isKeyboardShown() { return kb; },
    async dismissKeyboard() { kb = false; },
    async back() {}, async swipe() {}, async deepLink() {},
    async screenshot(p: string) { return p; },
    async routeHint() { return 'com.x/.Form'; },
    async waitForIdle() {},
  };
  return d;
}

/** A device whose clearText is a no-op → type appends → "AAABBB" bug. */
function appendBugDriver() {
  let value = 'Label *';
  const tree = (): UiNode => ({
    className: 'screen.form',
    bounds: { x: 0, y: 0, w: 1080, h: 2400 },
    children: [
      { className: 'android.widget.EditText', resourceId: 'com.x:id/in', text: value, focusable: true, clickable: true, enabled: true, bounds: { x: 0, y: 200, w: 1080, h: 120 }, children: [] },
    ],
  });
  let started = false;
  const d: DeviceDriver = {
    async launch() {}, async uiTree() { return tree(); },
    async tap() {},
    async type(t: string) { if (!started) { value = ''; started = true; } value += t; }, // first clear resets, then appends
    async clearText() {}, // BUG: no-op
    async pressEnter() {},
    async isKeyboardShown() { return true; },
    async dismissKeyboard() {},
    async back() {}, async swipe() {}, async deepLink() {},
    async screenshot(p: string) { return p; },
    async routeHint() { return 'com.x/.Form'; },
    async waitForIdle() {},
  };
  return d;
}

describe('runDeviceBenchmark', () => {
  it('passes keyboard-detect and text-replace on a correct driver', async () => {
    const card = await runDeviceBenchmark(goodDriver());
    const byName = Object.fromEntries(card.probes.map((p) => [p.name, p]));
    expect(byName['keyboard-detect'].status).toBe('pass');
    expect(byName['text-replace'].status).toBe('pass');
    expect(card.summary.fail).toBe(0);
  });

  it('catches a clearText-append bug', async () => {
    const card = await runDeviceBenchmark(appendBugDriver());
    const replace = card.probes.find((p) => p.name === 'text-replace')!;
    expect(replace.status).toBe('fail');
    expect(replace.detail).toMatch(/AAABBB|append/);
  });

  it('marks probes n/a when the screen has no editable field', async () => {
    const blank: DeviceDriver = {
      async launch() {}, async uiTree() { return { className: 'screen.blank', bounds: { x: 0, y: 0, w: 1080, h: 2400 }, children: [] }; },
      async tap() {}, async type() {}, async clearText() {}, async pressEnter() {},
      async isKeyboardShown() { return false; }, async dismissKeyboard() {}, async back() {}, async swipe() {}, async deepLink() {},
      async screenshot(p: string) { return p; }, async routeHint() { return undefined; }, async waitForIdle() {},
    };
    const card = await runDeviceBenchmark(blank);
    const byName = Object.fromEntries(card.probes.map((p) => [p.name, p]));
    expect(byName['keyboard-detect'].status).toBe('n/a');
    expect(byName['text-replace'].status).toBe('n/a');
    expect(byName['scroll-coverage'].status).toBe('n/a');
  });
});
