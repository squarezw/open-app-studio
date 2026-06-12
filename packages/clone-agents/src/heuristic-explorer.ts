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
import { scoreCandidate, signatureOf } from './policy.js';

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
  /** Decision strategy: which candidate to act on. Defaults to the heuristic policy. */
  decide?: Decider;
  /** High-level goal passed to a goal-directed (LLM) decider. */
  goal?: string;
}

interface Interactable {
  selector: Selector;
  center: { x: number; y: number };
  /** A text field we should type into rather than just tap. */
  editable: boolean;
  /** Hint for input synthesis (resource id + content-desc + class, lowercased). */
  hint: string;
}

/** A scored, pickable element on the current screen (passed to a Decider). */
export interface Candidate {
  index: number;
  label: string;
  hint: string;
  editable: boolean;
  score: number;
  selector: Selector;
  center: { x: number; y: number };
}

export interface DecisionContext {
  goal?: string;
  screen: { title?: string; routeHint?: string; visits: number };
  candidates: Candidate[];
  /** Recent "screen → action" lines, oldest first. */
  history: string[];
}

export type Decision =
  | { act: 'tap'; index: number; reason?: string }
  | { act: 'type'; index: number; value?: string; reason?: string }
  | { act: 'back'; reason?: string }
  | { act: 'stop'; reason?: string };

export type Decider = (ctx: DecisionContext) => Decision | Promise<Decision>;

/** Default policy-driven decider: take the highest-scoring candidate. */
export const heuristicDecide: Decider = (ctx) => {
  if (ctx.candidates.length === 0) return { act: 'back', reason: 'no candidates' };
  const best = ctx.candidates.reduce((a, b) => (b.score > a.score ? b : a));
  return best.editable ? { act: 'type', index: best.index } : { act: 'tap', index: best.index };
};

function labelOf(selector: Selector): string {
  return selector.text ?? selector.accessibilityId ?? selector.resourceId?.split('/').pop() ?? 'element';
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

  const decide = opts.decide ?? heuristicDecide;
  await driver.launch(opts.appId);

  let pending: { fromId: string; action: Action; signature?: string } | undefined;
  let consecutiveBacks = 0;
  let launchNodeId: string | undefined;
  let appPackage: string | undefined;
  let consecutiveRelaunches = 0;
  const history: string[] = [];
  // Cross-screen learning: which node a recurring button leads to, and how
  // often we've landed on each node — so we stop re-opening known dead-ends.
  const destinationOf = new Map<string, string>();
  const visitCount = new Map<string, number>();

  for (let step = 0; step < maxActions; step++) {
    const tree = await driver.uiTree();
    const routeHint = await driver.routeHint();

    // Stay inside the app under test. Pressing back on the root screen, or
    // tapping something that opens another app, drops us on the launcher /
    // Google app — we must NOT map those. Detect a foreign foreground package
    // and relaunch the target instead of recording the stray screen.
    const pkg = routeHint?.split('/')[0];
    if (appPackage && pkg && pkg !== appPackage) {
      if (++consecutiveRelaunches > 3) {
        log(`[${step}] left ${appPackage} and couldn't return (now ${pkg}) — stopping`);
        break;
      }
      log(`[${step}] left app (foreground ${pkg}) — relaunching ${opts.appId}`);
      await driver.launch(opts.appId);
      pending = undefined; // drop the edge that led out of the app
      await driver.waitForIdle();
      continue;
    }
    consecutiveRelaunches = 0;

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
    launchNodeId ??= nodeId;
    appPackage ??= pkg; // first in-app screen defines the target package
    visitCount.set(nodeId, (visitCount.get(nodeId) ?? 0) + 1);

    if (pending) {
      graph.recordAction(pending.fromId, pending.action, nodeId);
      // Record where this button actually went (first destination wins).
      if (pending.signature && !destinationOf.has(pending.signature)) {
        destinationOf.set(pending.signature, nodeId);
      }
      pending = undefined;
    }

    if (opts.shouldStop?.(graph.counts)) {
      log(`[${step}] external stop condition — stopping`);
      break;
    }

    const screenHeight = tree.bounds?.h ?? 2400;
    const interactables = collectInteractables(tree);
    for (const i of interactables) graph.noteInteractable(nodeId, i.selector);
    const editableFields = interactables.filter((i) => i.editable);

    // Build scored candidates from untried interactables, pruning recurring
    // buttons whose destination is already fully explored (the scanner trap).
    const untriedKeys = new Set(graph.untried(nodeId).map((s) => selectorKey(s)));
    const title = guessTitle(tree);

    // Forms first (deterministic, ahead of the decider): a screen with a
    // multi-field form and unfilled fields gets every field filled by its own
    // hint before anything taps a submit button — otherwise validation fails
    // on empties and backing out pops a "discard changes?" dialog (the trap the
    // explorer got stuck in on iHerb's address form). One keyboard-dismiss back
    // at the end (the IME is open after the last type, so it closes the
    // keyboard rather than navigating away).
    const untriedEditable = editableFields.filter((f) => untriedKeys.has(selectorKey(f.selector)));
    if (editableFields.length >= 2 && untriedEditable.length > 0) {
      for (const field of editableFields) {
        await driver.tap(field.center);
        await driver.waitForIdle();
        await driver.type(synthesizeInput(field.hint));
        graph.markTried(nodeId, field.selector);
      }
      await driver.back();
      log(`[${step}] ${nodeId} filled ${editableFields.length} form fields`);
      const first = editableFields[0]!;
      pending = {
        fromId: nodeId,
        action: { kind: 'type', selector: first.selector, point: first.center, inputValue: '(form)' },
        signature: signatureOf(first.selector),
      };
      history.push(`${title ?? nodeId} → fill form (${editableFields.length} fields)`);
      consecutiveBacks = 0;
      await driver.waitForIdle();
      continue;
    }

    const candidates: Candidate[] = [];
    for (const cand of interactables) {
      if (!untriedKeys.has(selectorKey(cand.selector))) continue;
      const signature = signatureOf(cand.selector);
      const dest = destinationOf.get(signature);
      if (dest && dest !== nodeId && !graph.hasUntried(dest)) {
        graph.markTried(nodeId, cand.selector);
        continue;
      }
      candidates.push({
        index: candidates.length,
        label: labelOf(cand.selector),
        hint: cand.hint,
        editable: cand.editable,
        score: scoreCandidate({
          hint: cand.hint,
          signature,
          yFraction: cand.center.y / screenHeight,
          knownDestination: dest,
          destinationVisits: dest ? (visitCount.get(dest) ?? 0) : 0,
          onHome: nodeId === launchNodeId,
        }),
        selector: cand.selector,
        center: cand.center,
      });
    }

    let decision = await decide({
      goal: opts.goal,
      screen: { title, routeHint, visits: visitCount.get(nodeId) ?? 1 },
      candidates,
      history: history.slice(-8),
    });
    // Validate decider output; fall back to a safe action.
    if ((decision.act === 'tap' || decision.act === 'type') && !candidates[decision.index]) {
      decision = candidates.length > 0 ? { act: 'tap', index: 0 } : { act: 'back' };
    }

    if (decision.act === 'stop') {
      log(`[${step}] decider: stop${decision.reason ? ` — ${decision.reason}` : ''}`);
      break;
    }

    if (decision.act === 'back') {
      consecutiveBacks += 1;
      if (candidates.length === 0 && consecutiveBacks > maxBacks) {
        log(`[${step}] exhausted after ${consecutiveBacks - 1} backs — stopping`);
        break;
      }
      log(`[${step}] ${nodeId} back${decision.reason ? ` — ${decision.reason}` : ''}`);
      await driver.back();
      pending = { fromId: nodeId, action: { kind: 'back' } };
      history.push(`${title ?? nodeId} → (back)`);
    } else {
      consecutiveBacks = 0;
      const chosen = candidates[decision.index]!;
      graph.markTried(nodeId, chosen.selector);
      const signature = signatureOf(chosen.selector);
      if (decision.act === 'type') {
        // Single text field (search): focus, type, submit, dismiss keyboard.
        // (Multi-field forms are filled deterministically before the decider.)
        const value = decision.value ?? synthesizeInput(chosen.hint);
        log(`[${step}] ${nodeId} type ${JSON.stringify(value)} into "${chosen.label}"${decision.reason ? ` — ${decision.reason}` : ''}`);
        await driver.tap(chosen.center);
        await driver.waitForIdle();
        await driver.type(value);
        await driver.pressEnter();
        await driver.back();
        pending = {
          fromId: nodeId,
          action: { kind: 'type', selector: chosen.selector, point: chosen.center, inputValue: value },
          signature,
        };
        history.push(`${title ?? nodeId} → type "${value}" in ${chosen.label}`);
      } else {
        log(`[${step}] ${nodeId} tap "${chosen.label}"${decision.reason ? ` — ${decision.reason}` : ''}`);
        await driver.tap(chosen.center);
        pending = {
          fromId: nodeId,
          action: { kind: 'tap', selector: chosen.selector, point: chosen.center },
          signature,
        };
        history.push(`${title ?? nodeId} → tap ${chosen.label}`);
      }
    }
    await driver.waitForIdle();
  }

  return graph.toIFG();
}

/** Clickable (or editable), enabled, visibly-sized elements, top-to-bottom. */
export function collectInteractables(root: UiNode): Interactable[] {
  const out: Interactable[] = [];
  walk(root, []);
  out.sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x);
  return out;

  function walk(node: UiNode, path: number[]): void {
    const b = node.bounds;
    const editable = isEditable(node);
    if ((node.clickable || editable) && node.enabled !== false && b && b.w > 0 && b.h > 0) {
      out.push({
        selector: toSelector(node, path),
        center: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        editable,
        hint: `${node.resourceId ?? ''} ${node.contentDesc ?? ''} ${node.className}`.toLowerCase(),
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

/**
 * True text-entry widgets only — EditText / SearchView / AutoComplete. A
 * clickable View that merely *opens* a search screen is left as a normal tap
 * (it navigates forward); the real input box on the next screen is what we type
 * into.
 */
function isEditable(node: UiNode): boolean {
  const cls = node.className.toLowerCase();
  return cls.includes('edittext') || cls.includes('searchview') || cls.includes('autocomplete');
}

/** Synthesize a plausible value for a field from its hint (design: realistic inputs, never real creds). */
export function synthesizeInput(hint: string): string {
  if (/pass(word|code)|pwd/.test(hint)) return 'Test1234!';
  if (/email|e-mail/.test(hint)) return 'test@example.com';
  if (/phone|mobile|tel/.test(hint)) return '5551234567';
  if (/zip|postal/.test(hint)) return '10001';
  if (/(first|last|full)?\s?name|recipient/.test(hint)) return 'Test User';
  if (/address|street|line\s?1|line\s?2/.test(hint)) return '123 Main St';
  if (/city|town/.test(hint)) return 'New York';
  if (/state|province|region/.test(hint)) return 'NY';
  if (/search|query|find/.test(hint)) return 'vitamin';
  return 'test';
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
