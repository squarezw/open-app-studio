import type { Point, UiNode } from '@oas/flow-graph';
import type { DeviceDriver } from './types.js';

/**
 * An in-memory simulated app behind the DeviceDriver interface — used for
 * tests, demos without an emulator, and gateway smoke runs (`driver: "fake"`).
 */
export interface FakeApp {
  initial: string;
  screens: Record<string, UiNode>;
  /** screen → (resourceId | contentDesc | text of tapped element) → next screen */
  transitions: Record<string, Record<string, string>>;
  routeHintOf?: (screen: string) => string;
}

export class FakeDriver implements DeviceDriver {
  private app: FakeApp;
  private current: string;
  private stack: string[] = [];

  constructor(app: FakeApp = DEMO_SHOP_APP) {
    this.app = app;
    this.current = app.initial;
  }

  async launch(): Promise<void> {
    this.current = this.app.initial;
    this.stack = [];
  }

  async uiTree(): Promise<UiNode> {
    return this.app.screens[this.current]!;
  }

  async tap(point: Point): Promise<void> {
    const hit = findClickableAt(this.app.screens[this.current]!, point);
    const key = hit?.resourceId ?? hit?.contentDesc ?? hit?.text;
    const target = key ? this.app.transitions[this.current]?.[key] : undefined;
    if (target) {
      this.stack.push(this.current);
      this.current = target;
    }
  }

  async back(): Promise<void> {
    this.current = this.stack.pop() ?? this.app.initial;
  }

  async screenshot(outPath: string): Promise<string> {
    return outPath;
  }
  async swipe(): Promise<void> {}
  async type(): Promise<void> {}
  async clearText(): Promise<void> {}
  async pressEnter(): Promise<void> {}
  async dismissKeyboard(): Promise<void> {}
  async deepLink(): Promise<void> {}
  async routeHint(): Promise<string | undefined> {
    return this.app.routeHintOf?.(this.current) ?? `fake/.${capitalize(this.current)}Activity`;
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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

function title(text: string): UiNode {
  return {
    className: 'android.widget.TextView',
    text,
    bounds: { x: 40, y: 60, w: 600, h: 80 },
    children: [],
  };
}

function screen(name: string, children: UiNode[]): UiNode {
  return {
    className: `screen.${name}`,
    bounds: { x: 0, y: 0, w: 1080, h: 2400 },
    children,
  };
}

/**
 * Default demo app: a tiny shop.
 *
 *   home ─ Search ──→ search
 *     ├── Profile ──→ profile ─ Settings ──→ settings
 *     └── Cart ─────→ cart ─ Checkout ────→ checkout
 */
export const DEMO_SHOP_APP: FakeApp = {
  initial: 'home',
  screens: {
    home: screen('home', [
      title('FakeShop Home'),
      btn('com.fakeshop:id/btn_search', 'Search', 200),
      btn('com.fakeshop:id/btn_profile', 'My Profile', 400),
      btn('com.fakeshop:id/btn_cart', 'Cart', 600),
    ]),
    search: screen('search', [
      title('Search products'),
      { className: 'android.widget.EditText', resourceId: 'com.fakeshop:id/search_input', text: '', children: [] },
    ]),
    profile: screen('profile', [
      title('My Profile'),
      btn('com.fakeshop:id/btn_settings', 'Settings', 500),
    ]),
    settings: screen('settings', [title('Settings')]),
    cart: screen('cart', [
      title('Shopping Cart'),
      btn('com.fakeshop:id/btn_checkout', 'Checkout', 2000),
    ]),
    checkout: screen('checkout', [title('Checkout — payment')]),
  },
  transitions: {
    home: {
      'com.fakeshop:id/btn_search': 'search',
      'com.fakeshop:id/btn_profile': 'profile',
      'com.fakeshop:id/btn_cart': 'cart',
    },
    profile: { 'com.fakeshop:id/btn_settings': 'settings' },
    cart: { 'com.fakeshop:id/btn_checkout': 'checkout' },
  },
};
