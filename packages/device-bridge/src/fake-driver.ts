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
  async isKeyboardShown(): Promise<boolean> {
    return true; // the fake world shows a keyboard for text fields
  }
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

/** A bottom-tab item: a clickable frame in the bottom band, evenly spaced. */
function tab(resourceId: string, label: string, x: number): UiNode {
  return {
    className: 'android.widget.FrameLayout',
    resourceId,
    contentDesc: label,
    clickable: true,
    enabled: true,
    bounds: { x, y: 2280, w: 270, h: 120 },
    children: [],
  };
}

/** A BottomNavigationView with the four standard tabs, shared by every main screen. */
function tabbar(): UiNode {
  return {
    className: 'com.google.android.material.bottomnavigation.BottomNavigationView',
    resourceId: 'com.tabbed:id/bottom_nav',
    bounds: { x: 0, y: 2280, w: 1080, h: 120 },
    children: [
      tab('com.tabbed:id/nav_home', 'Home', 0),
      tab('com.tabbed:id/nav_search', 'Search', 270),
      tab('com.tabbed:id/nav_cart', 'Cart', 540),
      tab('com.tabbed:id/nav_profile', 'Profile', 810),
    ],
  };
}

const NAV: Record<string, string> = {
  'com.tabbed:id/nav_home': 'main',
  'com.tabbed:id/nav_search': 'tsearch',
  'com.tabbed:id/nav_cart': 'tcart',
  'com.tabbed:id/nav_profile': 'tprofile',
};

/**
 * A tabbed app for exercising tabbar-aware exploration:
 *
 *   splash ─Continue→ login ─Sign in→ main [Home·Search·Cart·Profile tabs]
 *   main ─Promo→ promo (detail, no tabs)
 *   Cart tab → tcart ─Checkout→ checkout (detail, no tabs)
 *
 * splash + login are pre-main; everything from `main` on is main-phase.
 */
export const DEMO_TABBED_APP: FakeApp = {
  initial: 'splash',
  screens: {
    splash: screen('splash', [title('Welcome'), btn('com.tabbed:id/btn_continue', 'Continue', 1200)]),
    login: screen('login', [title('Sign In'), btn('com.tabbed:id/btn_signin', 'Sign in', 1200)]),
    main: screen('main', [title('Home Feed'), btn('com.tabbed:id/btn_promo', 'Promo', 400), tabbar()]),
    promo: screen('promo', [title('Promo Details')]),
    tsearch: screen('tsearch', [title('Search'), tabbar()]),
    tcart: screen('tcart', [title('Cart'), btn('com.tabbed:id/btn_checkout', 'Checkout', 400), tabbar()]),
    checkout: screen('checkout', [title('Checkout')]),
    tprofile: screen('tprofile', [title('Profile'), tabbar()]),
  },
  transitions: {
    splash: { 'com.tabbed:id/btn_continue': 'login' },
    login: { 'com.tabbed:id/btn_signin': 'main' },
    main: { 'com.tabbed:id/btn_promo': 'promo', ...NAV },
    tsearch: { ...NAV },
    tcart: { 'com.tabbed:id/btn_checkout': 'checkout', ...NAV },
    tprofile: { ...NAV },
  },
};
