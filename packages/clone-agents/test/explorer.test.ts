import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import type { DeviceDriver } from '@oas/device-bridge';
import type { Point, UiNode } from '@oas/flow-graph';
import { explore } from '../src/heuristic-explorer.js';

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
