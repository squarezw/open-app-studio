import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import type { DeviceDriver } from '@oas/device-bridge';
import type { Point, UiNode } from '@oas/flow-graph';
import { collectInteractables, explore, pickFirstOption, synthesizeInput } from '../src/heuristic-explorer.js';

/**
 * A fake 5-screen app:
 *
 *   home ── btn_list ──→ list ── item(apple) ──→ detail
 *     └── btn_profile ──→ profile ── btn_edit ──→ form
 *
 * The explorer should discover all 5 screens and all 4 forward
 * transitions with zero frontier left, and the IFG must validate
 * against schemas/ifg.schema.json.
 */

function btn(resourceId: string, text: string, y: number): UiNode {
  return {
    className: 'android.widget.Button',
    resourceId,
    text,
    clickable: true,
    enabled: true,
    bounds: { x: 0, y, w: 1080, h: 150 },
    children: [],
  };
}

function screenRoot(name: string, children: UiNode[]): UiNode {
  return {
    className: `screen.${name}`,
    bounds: { x: 0, y: 0, w: 1080, h: 2400 },
    children,
  };
}

const SCREENS: Record<string, UiNode> = {
  home: screenRoot('home', [btn('com.demo:id/btn_list', 'List', 100), btn('com.demo:id/btn_profile', 'Profile', 300)]),
  list: screenRoot('list', [
    {
      className: 'android.widget.TextView',
      contentDesc: 'item apple',
      text: 'Apple',
      clickable: true,
      enabled: true,
      bounds: { x: 0, y: 200, w: 1080, h: 160 },
      children: [],
    },
  ]),
  detail: screenRoot('detail', [
    { className: 'android.widget.TextView', text: 'Apple detail', children: [] },
  ]),
  profile: screenRoot('profile', [btn('com.demo:id/btn_edit', 'Edit', 500)]),
  form: screenRoot('form', [
    { className: 'android.widget.EditText', text: '', children: [] },
  ]),
};

const TRANSITIONS: Record<string, Record<string, string>> = {
  home: { 'com.demo:id/btn_list': 'list', 'com.demo:id/btn_profile': 'profile' },
  list: { 'item apple': 'detail' },
  profile: { 'com.demo:id/btn_edit': 'form' },
};

class FakeDriver implements DeviceDriver {
  current = 'home';
  stack: string[] = [];
  taps = 0;

  async launch(): Promise<void> {
    this.current = 'home';
    this.stack = [];
  }

  async uiTree(): Promise<UiNode> {
    return SCREENS[this.current]!;
  }

  async tap(point: Point): Promise<void> {
    this.taps += 1;
    const hit = findClickableAt(SCREENS[this.current]!, point);
    const key = hit?.resourceId ?? hit?.contentDesc ?? hit?.text;
    const target = key ? TRANSITIONS[this.current]?.[key] : undefined;
    if (target) {
      this.stack.push(this.current);
      this.current = target;
    }
  }

  async back(): Promise<void> {
    this.current = this.stack.pop() ?? 'home';
  }

  async screenshot(outPath: string): Promise<string> {
    return outPath;
  }
  async swipe(): Promise<void> {}
  async type(): Promise<void> {}
  async pressEnter(): Promise<void> {}
  async clearText(): Promise<void> {}
  async dismissKeyboard(): Promise<void> {}
  async deepLink(): Promise<void> {}
  async routeHint(): Promise<string | undefined> {
    return `com.demo/.${this.current}Activity`;
  }
  async waitForIdle(): Promise<void> {}
}

function findClickableAt(node: UiNode, p: Point): UiNode | undefined {
  let found: UiNode | undefined;
  const walk = (n: UiNode): void => {
    const b = n.bounds;
    if (n.clickable && b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      found = n;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return found;
}

describe('heuristic explorer (integration, fake device)', () => {
  it('discovers every screen and transition, leaving no frontier', async () => {
    const driver = new FakeDriver();
    const ifg = await explore(driver, { appId: 'com.demo', maxActions: 40 });

    expect(ifg.nodes).toHaveLength(5);
    expect(ifg.frontier).toHaveLength(0);

    const routeOf = (id: string) => ifg.nodes.find((n) => n.id === id)?.routeHint;
    const forward = ifg.edges
      .filter((e) => e.action.kind === 'tap' && e.from !== e.to)
      .map((e) => `${routeOf(e.from)}→${routeOf(e.to)}`);
    expect(forward).toEqual(
      expect.arrayContaining([
        'com.demo/.homeActivity→com.demo/.listActivity',
        'com.demo/.listActivity→com.demo/.detailActivity',
        'com.demo/.homeActivity→com.demo/.profileActivity',
        'com.demo/.profileActivity→com.demo/.formActivity',
      ]),
    );

    const backEdges = ifg.edges.filter((e) => e.action.kind === 'back');
    expect(backEdges.length).toBeGreaterThan(0);
    expect(ifg.meta.coverage?.actions).toBeGreaterThanOrEqual(driver.taps);
  });

  it('produces an IFG that validates against the published JSON schema', async () => {
    const ifg = await explore(new FakeDriver(), { appId: 'com.demo', maxActions: 40 });

    const schemaPath = new URL('../../../schemas/ifg.schema.json', import.meta.url);
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const valid = validate(ifg);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('respects the action budget', async () => {
    const driver = new FakeDriver();
    const ifg = await explore(driver, { appId: 'com.demo', maxActions: 3 });
    expect(ifg.meta.coverage?.actions).toBeLessThanOrEqual(3);
    expect((ifg.frontier?.length ?? 0)).toBeGreaterThan(0);
  });
});

describe('bounded scrolling', () => {
  const scrollList = (root: UiNode, children: UiNode[]): UiNode => ({
    className: 'screen.page',
    bounds: { x: 0, y: 0, w: 1080, h: 2400 },
    children: [{ className: 'androidx.recyclerview.widget.RecyclerView', scrollable: true, bounds: { x: 0, y: 0, w: 1080, h: 2400 }, children, ...root }],
  });
  const leaf = (id: string, y: number): UiNode => ({
    className: 'android.widget.Button', resourceId: id, text: id, clickable: true, enabled: true,
    bounds: { x: 0, y, w: 1080, h: 120 }, children: [],
  });

  const terminal: UiNode = { className: 'screen.done', bounds: { x: 0, y: 0, w: 1080, h: 2400 }, children: [] };

  function makeDriver(pageFor: (scrollPos: number) => UiNode) {
    let pos = 0;
    let left = false;
    const swipes: number[] = [];
    const driver: DeviceDriver = {
      async launch() { pos = 0; left = false; },
      async uiTree() { return left ? terminal : pageFor(pos); },
      async tap() {},
      async swipe() { swipes.push(pos); pos += 1; },
      async type() {}, async clearText() {}, async pressEnter() {},
      async isKeyboardShown() { return false; }, async dismissKeyboard() {},
      async back() { left = true; }, // back leaves the page (realistic)
      async deepLink() {},
      async screenshot(p: string) { return p; },
      async routeHint() { return undefined; },
      async waitForIdle() {},
    };
    return { driver, swipes: () => swipes };
  }

  it('scrolls a long page through its distinct sections, then stops at the bottom', async () => {
    // 3 distinct sections (pos 0,1,2); pos>=2 keeps returning the last section
    // = bottom reached (structure stops changing → scrollExhausted).
    const { driver, swipes } = makeDriver((pos) => {
      const p = Math.min(pos, 2);
      return scrollList({}, [leaf(`sec${p}_a`, 200), leaf(`sec${p}_b`, 400)]);
    });
    await explore(driver, { appId: 'com.x', maxActions: 30 });
    // scrolled through ~3 sections then stopped — never runs away
    expect(swipes().length).toBeGreaterThanOrEqual(2);
    expect(swipes().length).toBeLessThanOrEqual(4);
  });

  it('stops scrolling an infinite feed after one no-op scroll (stable fingerprint)', async () => {
    // Structure is identical at every scroll position (an infinite feed):
    // content-invariant fingerprint never changes → scroll reveals "nothing
    // new" → marked exhausted → at most one scroll attempt.
    const { driver, swipes } = makeDriver(() =>
      scrollList({}, [leaf('feed_row', 200), leaf('feed_row', 400)]),
    );
    await explore(driver, { appId: 'com.x', maxActions: 30 });
    expect(swipes().length).toBeLessThanOrEqual(1);
  });
});

describe('text input handling', () => {
  it('detects EditText and search fields as editable', () => {
    const screen: UiNode = {
      className: 'FrameLayout',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'android.widget.EditText', resourceId: 'com.x:id/q', clickable: true, enabled: true, bounds: { x: 0, y: 100, w: 1080, h: 120 }, children: [] },
        { className: 'androidx.appcompat.widget.SearchView', resourceId: 'com.x:id/sv', clickable: true, enabled: true, bounds: { x: 0, y: 240, w: 1080, h: 120 }, children: [] },
        // A clickable View that merely opens the search screen — a tap, not an input.
        { className: 'android.view.View', resourceId: 'com.x:id/iCLTopBarInputRect', clickable: true, enabled: true, contentDesc: 'Search iHerb', bounds: { x: 0, y: 380, w: 1080, h: 120 }, children: [] },
        { className: 'android.widget.Button', resourceId: 'com.x:id/go', clickable: true, enabled: true, bounds: { x: 0, y: 520, w: 1080, h: 120 }, children: [] },
      ],
    };
    const items = collectInteractables(screen);
    const byId = (id: string) => items.find((i) => i.selector.resourceId === id);
    expect(byId('com.x:id/q')!.editable).toBe(true);
    expect(byId('com.x:id/sv')!.editable).toBe(true);
    expect(byId('com.x:id/iCLTopBarInputRect')!.editable).toBe(false);
    expect(byId('com.x:id/go')!.editable).toBe(false);
  });

  it('synthesizes plausible values by field hint, never real creds', () => {
    expect(synthesizeInput('com.x:id/search_query searchview')).toBe('vitamin');
    expect(synthesizeInput('login password field')).toBe('Test1234!');
    expect(synthesizeInput('email address')).toBe('test@example.com');
    expect(synthesizeInput('phone number')).toBe('5551234567');
    expect(synthesizeInput('full name')).toBe('Test User');
    expect(synthesizeInput('address line 1')).toBe('123 Main St');
    expect(synthesizeInput('zip / postal code')).toBe('10001');
    expect(synthesizeInput('some other field')).toBe('test');
  });

  it('fills every text field, skips dropdowns, dedups by typed value (no per-field back)', async () => {
    // A stateful form mirroring iHerb: ALL fields share one resourceId, the
    // label lives in `text`, dropdowns are focusable:false, and typing updates
    // the field's visible text (so dedup-by-current-text works like a real device).
    const labels = [
      { label: 'United States', focusable: false }, // Country dropdown — must be skipped
      { label: 'Full Name *', focusable: true },
      { label: 'Address Line 1 *', focusable: true },
      { label: 'State / Region *', focusable: false }, // State dropdown — skipped
      { label: 'Zip / Postal Code *', focusable: true },
    ];
    const values = labels.map((l) => l.label); // mutated as we "type"
    const typed: string[] = [];
    let backs = 0;
    const buildTree = (): UiNode => ({
      className: 'screen.address_form',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: labels.map((l, i) => ({
        className: 'android.widget.EditText',
        resourceId: 'com.x:id/input_edit_text', // shared id, like iHerb
        text: values[i],
        focusable: l.focusable,
        clickable: true,
        enabled: true,
        bounds: { x: 0, y: 200 + i * 160, w: 1080, h: 120 },
        children: [],
      })),
    });
    let focused = -1;
    const driver: DeviceDriver = {
      async launch() {},
      async uiTree() { return buildTree(); },
      async tap(p) { focused = Math.round((p.y - 260) / 160); },
      async type(t: string) { typed.push(t); if (focused >= 0) values[focused] = t; },
      async clearText() {},
      async pressEnter() {},
      async isKeyboardShown() { return true; },
      async dismissKeyboard() {},
      async back() { backs += 1; },
      async swipe() {}, async deepLink() {},
      async screenshot(p: string) { return p; },
      async routeHint() { return 'com.x/.AddressForm'; },
      async waitForIdle() {},
    };

    await explore(driver, { appId: 'com.x', maxActions: 1 });
    // The 3 focusable text fields get filled by their label; the 2 dropdowns are skipped.
    expect(typed).toEqual(['Test User', '123 Main St', '10001']);
    // the fill itself never presses a raw back — so no "discard changes?" dialog
    expect(backs).toBe(0);
  });

  it('pickFirstOption picks a real list option, skipping search/cancel/header', () => {
    const list: UiNode = {
      className: 'screen.state_picker',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'EditText', text: 'Search', clickable: true, bounds: { x: 0, y: 60, w: 1080, h: 120 }, children: [] }, // top search — skipped (y < 12%)
        { className: 'TextView', text: 'Cancel', clickable: true, bounds: { x: 900, y: 400, w: 160, h: 80 }, children: [] }, // dismiss — skipped
        { className: 'TextView', text: 'Alabama', clickable: true, bounds: { x: 0, y: 500, w: 1080, h: 120 }, children: [] },
        { className: 'TextView', text: 'Alaska', clickable: true, bounds: { x: 0, y: 640, w: 1080, h: 120 }, children: [] },
      ],
    };
    const pick = pickFirstOption(list);
    expect(pick).toEqual({ x: 540, y: 560 }); // Alabama's center
  });

  it('opens a dropdown, waits, picks an option, and returns to the form (Country/State picker)', async () => {
    // A form with one text field and one State dropdown (focusable:false). Tapping
    // the dropdown opens a list (after a "load"); picking an option sets its value.
    let mode: 'form' | 'list' = 'form';
    let stateValue = 'State / Region *';
    const formTree = (): UiNode => ({
      className: 'screen.address',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'android.widget.EditText', resourceId: 'com.x:id/f', text: 'Full Name *', focusable: true, clickable: true, enabled: true, bounds: { x: 0, y: 200, w: 1080, h: 120 }, children: [] },
        { className: 'android.widget.EditText', resourceId: 'com.x:id/f', text: 'Zip / Postal Code *', focusable: true, clickable: true, enabled: true, bounds: { x: 0, y: 360, w: 1080, h: 120 }, children: [] },
        { className: 'android.widget.EditText', resourceId: 'com.x:id/dd', text: stateValue, focusable: false, clickable: true, enabled: true, bounds: { x: 0, y: 520, w: 1080, h: 120 }, children: [] },
      ],
    });
    const listTree = (): UiNode => ({
      className: 'screen.state_list',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'TextView', text: 'California', clickable: true, bounds: { x: 0, y: 500, w: 1080, h: 120 }, children: [] },
        { className: 'TextView', text: 'New York', clickable: true, bounds: { x: 0, y: 640, w: 1080, h: 120 }, children: [] },
      ],
    });
    const driver: DeviceDriver = {
      async launch() {},
      async uiTree() { return mode === 'form' ? formTree() : listTree(); },
      async tap(p) {
        if (mode === 'form' && p.y >= 520 && p.y <= 640) mode = 'list';    // tapped the dropdown
        else if (mode === 'list') { stateValue = 'California'; mode = 'form'; } // picked an option
      },
      async type() {}, async clearText() {}, async pressEnter() {},
      async isKeyboardShown() { return true; },
      async dismissKeyboard() {}, async back() {},
      async swipe() {}, async deepLink() {},
      async screenshot(p: string) { return p; },
      async routeHint() { return 'com.x/.Address'; },
      async waitForIdle() {},
    };

    await explore(driver, { appId: 'com.x', maxActions: 1 });
    expect(stateValue).toBe('California'); // the dropdown got a real selection
    expect(mode).toBe('form'); // and we returned to the form
  });

  it('relaunches (not stop) when trapped on a no-candidate modal — if frontier remains', async () => {
    // Home has two entries: one opens a dead wheel-picker sheet (no clickable
    // items, eats back); the other is normal. When the explorer falls into the
    // dead sheet it must NOT kill the run — there's still untried frontier
    // (the other button), so it relaunches and keeps going.
    let launched = 0;
    let onModal = false;
    const home: UiNode = {
      className: 'screen.home',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'android.widget.Button', resourceId: 'com.x:id/open_picker', text: 'Quantity', clickable: true, enabled: true, bounds: { x: 0, y: 200, w: 1080, h: 140 }, children: [] },
        { className: 'android.widget.Button', resourceId: 'com.x:id/other', text: 'Other', clickable: true, enabled: true, bounds: { x: 0, y: 400, w: 1080, h: 140 }, children: [] },
      ],
    };
    const modal: UiNode = {
      className: 'screen.qty_picker',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [{ className: 'android.widget.TextView', text: 'Select quantity', bounds: { x: 40, y: 60, w: 400, h: 60 }, children: [] }],
    };
    const driver: DeviceDriver = {
      async launch() { launched += 1; onModal = false; },
      async uiTree() { return onModal ? modal : home; },
      async tap(p: Point) { if (!onModal && p.y >= 200 && p.y <= 340) onModal = true; }, // tapped "Quantity"
      async type() {}, async clearText() {}, async pressEnter() {},
      async isKeyboardShown() { return false; }, async dismissKeyboard() {},
      async back() { /* the modal eats back: no state change */ },
      async swipe() {}, async deepLink() {},
      async screenshot(p: string) { return p; },
      async routeHint() { return 'com.x/.Main'; },
      async waitForIdle() {},
    };

    const ifg = await explore(driver, { appId: 'com.x', maxActions: 12 });
    expect(launched).toBeGreaterThanOrEqual(2); // initial launch + ≥1 relaunch-to-escape
    expect(ifg.nodes.length).toBeGreaterThanOrEqual(2); // saw home + the dead modal, kept going
  });

  it('escapes a modal that eats back by tapping its exit button (the leave-dialog trap)', async () => {
    // The app resumes ON a "Sure you want to leave?" dialog whose buttons are
    // Leave (exits) and Cancel. back() is swallowed by the modal (no-op). The
    // explorer must stop backing and tap "Leave" to escape — not loop forever.
    const dialog: UiNode = {
      className: 'screen.leave_dialog',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'android.widget.TextView', text: 'Sure you want to leave now?', bounds: { x: 40, y: 200, w: 800, h: 60 }, children: [] },
        { className: 'android.widget.Button', resourceId: 'com.x:id/leave', text: 'Leave', clickable: true, enabled: true, bounds: { x: 40, y: 600, w: 1000, h: 140 }, children: [] },
        { className: 'android.widget.Button', resourceId: 'com.x:id/cancel', text: 'Cancel', clickable: true, enabled: true, bounds: { x: 40, y: 760, w: 1000, h: 140 }, children: [] },
      ],
    };
    const home: UiNode = {
      className: 'screen.home',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [{ className: 'android.widget.TextView', text: 'Home', bounds: { x: 40, y: 60, w: 300, h: 60 }, children: [] }],
    };
    let onDialog = true;
    let tappedLeave = false;
    const driver: DeviceDriver = {
      async launch() {},
      async uiTree() { return onDialog ? dialog : home; },
      async tap(p) {
        // "Leave" button is the one at y~670
        if (onDialog && p.y > 600 && p.y < 740) { tappedLeave = true; onDialog = false; }
      },
      async type() {}, async clearText() {}, async pressEnter() {}, async isKeyboardShown() { return true; }, async dismissKeyboard() {},
      async back() { /* modal swallows back: no state change */ },
      async swipe() {}, async deepLink() {},
      async screenshot(p: string) { return p; },
      async routeHint() { return 'com.x/.Main'; },
      async waitForIdle() {},
    };

    // Force the worst case: a decider that always says "back" (what the LLM did
    // live). The no-op-back detection must override it and tap to escape.
    const ifg = await explore(driver, { appId: 'com.x', maxActions: 30, decide: () => ({ act: 'back' }) });
    expect(tappedLeave).toBe(true); // escaped via the button, not infinite back
    // reached home after escaping; the dialog wasn't visited dozens of times
    const dialogNode = ifg.nodes.find((n) => /leave/i.test(n.title ?? ''));
    expect(dialogNode!.visits).toBeLessThan(6);
  });

  it('types + submits into a search box instead of re-tapping (the iHerb trap)', async () => {
    // A search screen whose box, once submitted, leads to a results screen.
    const search: UiNode = {
      className: 'screen.search',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'android.widget.EditText', resourceId: 'com.x:id/search_box', clickable: true, enabled: true, contentDesc: 'Search', bounds: { x: 0, y: 100, w: 1080, h: 120 }, children: [] },
      ],
    };
    const results: UiNode = {
      className: 'screen.results',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [{ className: 'android.widget.TextView', text: 'Results', bounds: { x: 40, y: 60, w: 400, h: 60 }, children: [] }],
    };

    const calls: string[] = [];
    let submitted = false;
    const driver: DeviceDriver = {
      async launch() {},
      async uiTree() {
        return submitted ? results : search;
      },
      async tap() {
        calls.push('tap');
      },
      async type(t: string) {
        calls.push(`type:${t}`);
      },
      async clearText() {},
      async pressEnter() {
        calls.push('enter');
        submitted = true; // search submitted → next screen is results
      },
      async isKeyboardShown() { return true; },
      async dismissKeyboard() {
        calls.push('dismiss');
      },
      async back() {
        calls.push('back');
      },
      async swipe() {},
      async deepLink() {},
      async screenshot(p: string) {
        return p;
      },
      async routeHint() {
        return undefined;
      },
      async waitForIdle() {},
    };

    const ifg = await explore(driver, { appId: 'com.x', maxActions: 4 });
    expect(calls).toContain('type:vitamin');
    expect(calls).toContain('enter');
    // the typed search produced a forward transition to the results screen
    const typeEdge = ifg.edges.find((e) => e.action.kind === 'type');
    expect(typeEdge).toBeDefined();
    expect(typeEdge!.action.inputValue).toBe('vitamin');
    expect(ifg.nodes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('prioritization & revisit suppression', () => {
  /**
   * home & cart both expose the SAME top-bar scanner button (resourceId
   * com.x:id/scan) leading to one dead-end scanner screen. The explorer should
   * open the scanner at most once and prefer the core cart→checkout path.
   */
  function btnNode(resourceId: string, text: string, y: number): UiNode {
    return { className: 'android.widget.Button', resourceId, text, clickable: true, enabled: true, bounds: { x: 0, y, w: 1080, h: 140 }, children: [] };
  }
  const SHOP: Record<string, UiNode> = {
    home: { className: 'screen.home', bounds: { x: 0, y: 0, w: 1080, h: 2400 }, children: [
      btnNode('com.x:id/scan', 'Scan barcode', 80),
      btnNode('com.x:id/cart', 'Cart', 300),
    ] },
    cart: { className: 'screen.cart', bounds: { x: 0, y: 0, w: 1080, h: 2400 }, children: [
      btnNode('com.x:id/scan', 'Scan barcode', 80), // SAME recurring scanner button
      btnNode('com.x:id/checkout', 'Checkout', 300),
    ] },
    scanner: { className: 'screen.scanner', bounds: { x: 0, y: 0, w: 1080, h: 2400 }, children: [] }, // dead end
    checkout: { className: 'screen.checkout', bounds: { x: 0, y: 0, w: 1080, h: 2400 }, children: [] },
  };
  const NAV: Record<string, Record<string, string>> = {
    home: { 'com.x:id/scan': 'scanner', 'com.x:id/cart': 'cart' },
    cart: { 'com.x:id/scan': 'scanner', 'com.x:id/checkout': 'checkout' },
  };

  class ShopDriver implements DeviceDriver {
    current = 'home';
    stack: string[] = [];
    async launch() { this.current = 'home'; this.stack = []; }
    async uiTree() { return SHOP[this.current]!; }
    async tap(p: Point) {
      const hit = findHit(SHOP[this.current]!, p);
      const target = hit?.resourceId ? NAV[this.current]?.[hit.resourceId] : undefined;
      if (target) { this.stack.push(this.current); this.current = target; }
    }
    async back() { this.current = this.stack.pop() ?? 'home'; }
    async screenshot(o: string) { return o; }
    async swipe() {}
    async type() {}
    async clearText() {}
    async pressEnter() {}
    async isKeyboardShown() { return true; }
    async dismissKeyboard() {}
    async deepLink() {}
    async routeHint() { return `com.x/.${this.current}`; }
    async waitForIdle() {}
  }
  function findHit(node: UiNode, p: Point): UiNode | undefined {
    let f: UiNode | undefined;
    const walk = (n: UiNode) => {
      const b = n.bounds;
      if (n.clickable && b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) f = n;
      n.children.forEach(walk);
    };
    walk(node);
    return f;
  }

  it('opens a recurring dead-end (scanner) once, and reaches the core checkout flow', async () => {
    const ifg = await explore(new ShopDriver(), { appId: 'com.x', maxActions: 30 });
    const titleVisits = (route: string) => ifg.nodes.find((n) => n.routeHint === route)?.visits ?? 0;

    expect(titleVisits('com.x/.checkout')).toBeGreaterThanOrEqual(1); // core path reached
    expect(titleVisits('com.x/.scanner')).toBe(1); // scanner entered exactly once, not from both screens
  });
});
