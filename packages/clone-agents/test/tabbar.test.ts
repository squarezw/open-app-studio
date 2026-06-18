import { describe, expect, it } from 'vitest';
import {
  DEMO_LATE_TABBAR_APP,
  DEMO_SHOP_APP,
  DEMO_TABBED_APP,
  DEMO_TABBED_ENTRY_APP,
  FakeDriver,
} from '@oas/device-bridge';
import type { UiNode } from '@oas/flow-graph';
import { Orchestrator } from '../src/orchestrator.js';
import { detectTabBar, looksLikeTabSelector } from '../src/tabbar.js';

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

  it('detects tabs by resource-id shape (iHerb-style *_dest), even off the bottom band', () => {
    // No nav container, tabs sit at ~0.72 of height (geometry band would miss),
    // but their resourceIds end in _dest — the id signal catches them.
    const bar: UiNode = {
      className: 'android.widget.FrameLayout',
      bounds: { x: 0, y: 0, w: 1080, h: 2400 },
      children: [
        { className: 'V', resourceId: 'com.iherb:id/home_dest', clickable: true, contentDesc: 'Home', bounds: { x: 0, y: 1720, w: 216, h: 120 }, children: [] },
        { className: 'V', resourceId: 'com.iherb:id/explore_dest', clickable: true, contentDesc: 'Explore', bounds: { x: 216, y: 1720, w: 216, h: 120 }, children: [] },
        { className: 'V', resourceId: 'com.iherb:id/cart_dest', clickable: true, contentDesc: 'Cart', bounds: { x: 648, y: 1720, w: 216, h: 120 }, children: [] },
        { className: 'V', resourceId: 'com.iherb:id/me_dest', clickable: true, contentDesc: 'Me', bounds: { x: 864, y: 1720, w: 216, h: 120 }, children: [] },
      ],
    };
    const tabs = detectTabBar(bar);
    expect(tabs?.map((t) => t.label)).toEqual(['Home', 'Explore', 'Cart', 'Me']);
    expect(tabs?.map((t) => t.selector.resourceId)).toContain('com.iherb:id/cart_dest');
  });

  it('recognizes tab-item selectors by resource-id shape (skipped on every screen)', () => {
    expect(looksLikeTabSelector({ resourceId: 'com.iherb:id/myaccount_dest' })).toBe(true);
    expect(looksLikeTabSelector({ resourceId: 'com.iherb:id/cart_dest' })).toBe(true);
    expect(looksLikeTabSelector({ resourceId: 'com.app:id/tab_home' })).toBe(true);
    // ordinary content must NOT be mistaken for a tab
    expect(looksLikeTabSelector({ resourceId: 'com.iherb:id/ICLProductCard' })).toBe(false);
    expect(looksLikeTabSelector({ text: 'Add to Cart' })).toBe(false);
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

  it('enters each tab from the app entry (tabs are direct children of launch)', async () => {
    const orchestrator = new Orchestrator(new FakeDriver(DEMO_TABBED_ENTRY_APP), {
      appId: 'com.entry',
      maxActions: 80,
    });
    const ifg = await orchestrator.run();
    const launchId = ifg.nodes[0]!.id; // the tabbed home (launch)
    // A tab ROOT has both title and section equal to the tab label. (A tab's own
    // subtree may contain a screen that looks like another tab — e.g. a cart view
    // reached while exploring Me — so match on section, not title alone.)
    const tabRoot = (label: string) => ifg.nodes.find((n) => n.title === label && n.section === label);

    expect(tabRoot('Me')).toBeDefined();
    expect(tabRoot('Search')).toBeDefined();
    expect(tabRoot('Cart')).toBeDefined();

    // every tab root is reached directly from the launch/entry screen, not via a
    // sibling tab or a product page (the "To Me went Cart→Me" bug).
    for (const label of ['Search', 'Cart', 'Me']) {
      const node = tabRoot(label)!;
      const into = ifg.edges.filter((e) => e.to === node.id && e.action.kind !== 'back');
      expect(into.length).toBeGreaterThan(0);
      expect(into.every((e) => e.from === launchId)).toBe(true);
    }
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
