import type { Selector, UiNode } from '@oas/flow-graph';

/** A single bottom-tab entry — a top-level section root of the app. */
export interface TabItem {
  selector: Selector;
  center: { x: number; y: number };
  label: string;
}

/**
 * Resource-id / class hints for a bottom navigation container. Android calls it
 * many things (BottomNavigationView, TabLayout, a custom "bottom_bar" RelativeLayout);
 * iOS uses UITabBar. We match the common substrings case-insensitively.
 */
const NAV_CONTAINER_HINT =
  /(bottomnav|bottom_nav|bottom_bar|bottombar|navigation_?bar|navbar|tabbar|tab_bar|tablayout|uitabbar)/i;

/**
 * Detect a bottom tab bar on a screen and return its tabs (each is a top-level
 * entry). Two signals, container first then a generic geometric fallback:
 *
 *  1. A descendant whose resourceId/className looks like a nav container → its
 *     clickable leaf items are the tabs.
 *  2. Otherwise: a row of 2–5 clickable leaves sitting in the bottom band,
 *     spread across most of the screen width at roughly one y. This catches
 *     hand-rolled bars that carry no telltale id.
 *
 * Returns undefined when the screen has no tab bar (→ caller free-explores).
 */
export function detectTabBar(root: UiNode): TabItem[] | undefined {
  const screenH = root.bounds?.h ?? 2400;
  const screenW = root.bounds?.w ?? 1080;

  const container = findNavContainer(root);
  let items = container ? clickableLeaves(container) : [];

  if (items.length < 2) {
    // Generic: clickable leaves in the bottom ~18% band, each short (not a
    // full-height panel), sitting at roughly the same y.
    const band = clickableLeaves(root).filter((n) => {
      const b = n.bounds!;
      const cy = b.y + b.h / 2;
      return cy > screenH * 0.82 && b.h < screenH * 0.18;
    });
    items = sameRow(band, screenH);
  }

  // Dedup by center, order left-to-right.
  const seen = new Set<string>();
  const tabs = items
    .map((n) => ({ n, c: centerOf(n.bounds!) }))
    .filter(({ c }) => {
      const k = `${Math.round(c.x)},${Math.round(c.y)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.c.x - b.c.x);

  if (tabs.length < 2 || tabs.length > 6) return undefined;

  // Must span most of the width — guards against a cluster of buttons in one
  // corner masquerading as a tab bar.
  const span = tabs[tabs.length - 1]!.c.x - tabs[0]!.c.x;
  if (span < screenW * 0.5) return undefined;

  return tabs.map(({ n, c }) => ({ selector: toSelector(n), center: c, label: labelOf(n) }));
}

/** Stable key for a tab (used to track which tabs have been visited). */
export function tabKey(tab: TabItem): string {
  const s = tab.selector;
  return s.resourceId ?? s.accessibilityId ?? s.text ?? `${Math.round(tab.center.x)}:${Math.round(tab.center.y)}`;
}

function findNavContainer(root: UiNode): UiNode | undefined {
  let found: UiNode | undefined;
  const walk = (n: UiNode): void => {
    if (found) return;
    const id = `${n.resourceId ?? ''} ${n.className}`;
    if (NAV_CONTAINER_HINT.test(id) && clickableLeaves(n).length >= 2) found = n;
    n.children.forEach(walk);
  };
  walk(root);
  return found;
}

/** Clickable nodes that have no clickable descendant (the tappable leaves). */
function clickableLeaves(root: UiNode): UiNode[] {
  const out: UiNode[] = [];
  const containsClickable = (n: UiNode): boolean =>
    n.children.some((c) => c.clickable || containsClickable(c));
  const walk = (n: UiNode): void => {
    const b = n.bounds;
    if (n.clickable && n.enabled !== false && b && b.w > 0 && b.h > 0 && !containsClickable(n)) {
      out.push(n);
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Keep the largest group of elements sharing roughly one y (within 6% of height). */
function sameRow(nodes: UiNode[], screenH: number): UiNode[] {
  if (nodes.length < 2) return nodes;
  const tol = screenH * 0.06;
  let best: UiNode[] = [];
  for (const anchor of nodes) {
    const ay = centerOf(anchor.bounds!).y;
    const group = nodes.filter((n) => Math.abs(centerOf(n.bounds!).y - ay) <= tol);
    if (group.length > best.length) best = group;
  }
  return best;
}

function centerOf(b: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function labelOf(n: UiNode): string {
  return (n.text ?? n.contentDesc ?? n.resourceId?.split('/').pop() ?? 'tab').trim();
}

function toSelector(n: UiNode): Selector {
  if (n.resourceId) return { resourceId: n.resourceId };
  if (n.contentDesc) return { accessibilityId: n.contentDesc };
  if (n.text) return { text: n.text };
  const b = n.bounds!;
  return { xpath: `bottom@${Math.round(b.x + b.w / 2)}` };
}
