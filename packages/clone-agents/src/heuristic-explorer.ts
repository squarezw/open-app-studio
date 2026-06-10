import { join } from 'node:path';
import type { DeviceDriver } from '@oas/device-bridge';
import {
  GraphBuilder,
  selectorKey,
  type Action,
  type GraphEvent,
  type InteractionFlowGraph,
  type Platform,
  type Selector,
  type UiNode,
} from '@oas/flow-graph';

/**
 * M0 spike: a deterministic, LLM-free Explorer. It walks the app breadth-first
 * by tapping untried clickable elements, pressing back when a screen is
 * exhausted, and folding everything it sees into an IFG via GraphBuilder.
 *
 * The LLM-driven Explorer (goal-directed, form-filling) replaces the
 * `pickNext` policy in M1 — the observe/act/record loop stays the same.
 */
export interface ExploreOptions {
  appId: string;
  appName?: string;
  platform?: Platform;
  maxActions?: number;
  /** Directory for screenshots; omit to skip screenshot capture. */
  outDir?: string;
  /** Consecutive backs at an exhausted dead end before giving up. */
  maxConsecutiveBacks?: number;
  log?: (message: string) => void;
  /** Live graph-growth events (node/edge added) — the streaming contract. */
  onEvent?: (event: GraphEvent) => void;
  /** External stop condition, checked once per loop (budget, stall, abort). */
  shouldStop?: (counts: { nodes: number; edges: number; actions: number }) => boolean;
}

interface Interactable {
  selector: Selector;
  center: { x: number; y: number };
}

export async function explore(driver: DeviceDriver, opts: ExploreOptions): Promise<InteractionFlowGraph> {
  const maxActions = opts.maxActions ?? 60;
  const maxBacks = opts.maxConsecutiveBacks ?? 3;
  const log = opts.log ?? (() => {});

  const graph = new GraphBuilder(
    {
      appName: opts.appName ?? opts.appId,
      appId: opts.appId,
      platform: opts.platform ?? 'android-emulator',
    },
    opts.onEvent,
  );

  await driver.launch(opts.appId);

  let pending: { fromId: string; action: Action } | undefined;
  let consecutiveBacks = 0;

  for (let step = 0; step < maxActions; step++) {
    const tree = await driver.uiTree();
    const routeHint = await driver.routeHint();
    let screenshotRef: string | undefined;
    if (opts.outDir) {
      screenshotRef = await driver.screenshot(join(opts.outDir, 'screens', `step_${step}.png`));
    }
    const nodeId = graph.observe({
      tree,
      routeHint,
      screenshotRef,
      capturedAt: new Date().toISOString(),
      titleHint: guessTitle(tree),
    });

    if (pending) {
      graph.recordAction(pending.fromId, pending.action, nodeId);
      pending = undefined;
    }

    if (opts.shouldStop?.(graph.counts)) {
      log(`[${step}] external stop condition — stopping`);
      break;
    }

    const interactables = collectInteractables(tree);
    for (const i of interactables) graph.noteInteractable(nodeId, i.selector);

    const untried = graph.untried(nodeId);
    const next = untried.length > 0
      ? interactables.find((i) => selectorKey(i.selector) === selectorKey(untried[0]!))
      : undefined;

    if (next) {
      consecutiveBacks = 0;
      graph.markTried(nodeId, next.selector);
      log(`[${step}] ${nodeId} tap ${JSON.stringify(next.selector)}`);
      await driver.tap(next.center);
      pending = { fromId: nodeId, action: { kind: 'tap', selector: next.selector, point: next.center } };
    } else {
      consecutiveBacks += 1;
      if (consecutiveBacks > maxBacks) {
        log(`[${step}] exhausted after ${consecutiveBacks - 1} backs — stopping`);
        break;
      }
      log(`[${step}] ${nodeId} exhausted — back`);
      await driver.back();
      pending = { fromId: nodeId, action: { kind: 'back' } };
    }
    await driver.waitForIdle();
  }

  return graph.toIFG();
}

/** Clickable, enabled, visibly-sized elements, top-to-bottom. */
export function collectInteractables(root: UiNode): Interactable[] {
  const out: Interactable[] = [];
  walk(root, []);
  out.sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x);
  return out;

  function walk(node: UiNode, path: number[]): void {
    const b = node.bounds;
    if (node.clickable && node.enabled !== false && b && b.w > 0 && b.h > 0) {
      out.push({
        selector: toSelector(node, path),
        center: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      });
    }
    node.children.forEach((c, i) => walk(c, [...path, i]));
  }

  function toSelector(node: UiNode, path: number[]): Selector {
    if (node.resourceId) return { resourceId: node.resourceId };
    if (node.contentDesc) return { accessibilityId: node.contentDesc };
    if (node.text) return { text: node.text };
    return { xpath: `/${path.join('/')}`, index: path[path.length - 1] ?? 0 };
  }
}

/** Topmost short text element — a cheap human label for the screen. */
export function guessTitle(root: UiNode): string | undefined {
  let best: { text: string; y: number } | undefined;
  const walk = (n: UiNode): void => {
    const text = n.text?.trim();
    if (text && text.length <= 40 && n.bounds && (!best || n.bounds.y < best.y)) {
      best = { text, y: n.bounds.y };
    }
    n.children.forEach(walk);
  };
  walk(root);
  return best?.text;
}
