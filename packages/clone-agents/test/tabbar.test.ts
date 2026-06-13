import { describe, expect, it } from 'vitest';
import { DEMO_LATE_TABBAR_APP, DEMO_SHOP_APP, DEMO_TABBED_APP, FakeDriver } from '@oas/device-bridge';
import type { UiNode } from '@oas/flow-graph';
import { Orchestrator } from '../src/orchestrator.js';
import { detectTabBar } from '../src/tabbar.js';

describe('detectTabBar', () => {
  it('finds the four tabs of a BottomNavigationView', () => {
    const tabs = detectTabBar(DEMO_TABBED_APP.screens.main!);
    expect(tabs?.map((t) => t.label)).toEqual(['Home', 'Search', 'Cart', 'Profile']);
    // left-to-right order, each carries its resourceId selector
    expect(tabs?.[0]!.selector.resourceId).toBe('com.tabbed:id/nav_home');
  });

  it('returns undefined for a screen with no tab bar', () => {
    expect(detectTabBar(DEMO_SHOP_APP.screens.home!)).toBeUndefined();
    expect(detectTabBar(DEMO_TABBED_APP.screens.splash!)).toBeUndefined();
    expect(detectTabBar(DEMO_TABBED_APP.screens.promo!)).toBeUndefined();
  });

  it('detects a hand-rolled bar with no telltale id, geometrically', () => {
    const bar: UiNode = {
      className: 'android.widget.LinearLayout',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'Btn', text: 'Feed', clickable: true, bounds: { x: 40, y: 2300, w: 200, h: 90 }, children: [] },
        { className: 'Btn', text: 'Me', clickable: true, bounds: { x: 840, y: 2300, w: 200, h: 90 }, children: [] },
      ],
    };
    const tabs = detectTabBar(bar);
    expect(tabs?.map((t) => t.label)).toEqual(['Feed', 'Me']);
  });

  it('reads tab captions from a child TextView when the clickable node has none', () => {
    const tabs = detectTabBar(DEMO_LATE_TABBAR_APP.screens.detail!);
    // labels come from the child TextView, not the resourceId tail (tab_feed → "Feed")
    expect(tabs?.map((t) => t.label)).toEqual(['Feed', 'Browse', 'Me']);
  });

  it('does not mistake a single corner button for a tab bar', () => {
    const fab: UiNode = {
      className: 'android.widget.FrameLayout',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'Btn', text: 'Add', clickable: true, bounds: { x: 900, y: 2280, w: 140, h: 140 }, children: [] },
      ],
    };
    expect(detectTabBar(fab)).toBeUndefined();
  });
});

describe('tabbar-aware exploration (tabbed demo app)', () => {
  it('tags pre-main screens, marks the tabbar, and visits every tab', async () => {
    const orchestrator = new Orchestrator(new FakeDriver(DEMO_TABBED_APP), {
      appId: 'com.tabbed',
      maxActions: 80,
    });
    const ifg = await orchestrator.run();
    const byTitle = new Map(ifg.nodes.map((n) => [n.title, n]));

    // splash + login come before the tab bar → pre-main; main is tabbed.
    expect(byTitle.get('Welcome')?.phase).toBe('pre-main');
    expect(byTitle.get('Sign In')?.phase).toBe('pre-main');
    // the landing main screen is renamed after the first tab ("Home"), not the
    // generic top-text guess ("Home Feed").
    expect(byTitle.get('Home')?.phase).toBe('main');
    expect(byTitle.get('Home Feed')).toBeUndefined();

    // the main screen carries a detected tabbar pattern
    expect(byTitle.get('Home')?.patterns?.some((p) => p.kind === 'tabbar')).toBe(true);

    // every top-level section was reached (each tab explored as a root)
    const titles = ifg.nodes.map((n) => n.title);
    expect(titles).toContain('Search');
    expect(titles).toContain('Cart');
    expect(titles).toContain('Profile');
    // and a screen reached from within a section (Cart → Checkout) is main-phase
    expect(byTitle.get('Checkout')?.phase).toBe('main');
  });

  it('back-fills a screen that shows the tab bar but slipped geometric detection', async () => {
    const orchestrator = new Orchestrator(new FakeDriver(DEMO_LATE_TABBAR_APP), {
      appId: 'com.late',
      maxActions: 40,
    });
    const ifg = await orchestrator.run();
    const home = ifg.nodes[0]!; // launch node — its tab bar sits too high to detect directly

    // It carries the same tab selectors as the detail screen → reclassified main.
    expect(home.phase).toBe('main');
    expect(home.patterns?.some((p) => p.kind === 'tabbar')).toBe(true);
    // The launch landing is named after the first tab ("Feed"), not its top text.
    expect(home.title).toBe('Feed');
  });

  it('leaves phase undefined for an app with no tab bar', async () => {
    const orchestrator = new Orchestrator(new FakeDriver(DEMO_SHOP_APP), {
      appId: 'com.fakeshop',
      maxActions: 60,
    });
    const ifg = await orchestrator.run();
    expect(ifg.nodes.every((n) => n.phase === undefined)).toBe(true);
  });
});
