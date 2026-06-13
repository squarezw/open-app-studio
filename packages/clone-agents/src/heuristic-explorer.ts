import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeviceDriver } from '@oas/device-bridge';
import {
  fingerprint,
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
import { detectTabBar, tabKey, type TabItem } from './tabbar.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cap vertical scrolling per screen so infinite feeds can't run forever. */
const MAX_SCROLLS_PER_SCREEN = 4;

/** Does the screen contain a scrollable container? */
function hasScrollable(node: UiNode): boolean {
  if (node.scrollable) return true;
  return node.children.some(hasScrollable);
}

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
  /** A select/dropdown that opens a picker on tap (non-focusable EditText / Spinner). */
  dropdown: boolean;
  /** Hint for input synthesis (resource id + content-desc + text + class, lowercased). */
  hint: string;
  /** Current visible text/value of the element (the label when empty). */
  text?: string;
}

/** A scored, pickable element on the current screen (passed to a Decider). */
export interface Candidate {
  index: number;
  label: string;
  hint: string;
  editable: boolean;
  /** Opens a picker on tap (dropdown), vs a plain tap. */
  dropdown: boolean;
  /** Current visible text/value — distinguishes fields that share one resourceId. */
  text?: string;
  /** Vertical position 0=top..1=bottom — spatial disambiguation for the LLM. */
  yFraction: number;
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
  let lastObservedNodeId: string | undefined;
  let sameNodeStreak = 0;
  const scrollsByNode = new Map<string, number>();
  const scrollExhausted = new Set<string>();
  const history: string[] = [];
  // Cross-screen learning: which node a recurring button leads to, and how
  // often we've landed on each node — so we stop re-opening known dead-ends.
  const destinationOf = new Map<string, string>();
  const visitCount = new Map<string, number>();

  // Tabbar awareness. The first screen carrying a bottom tab bar is the tabbed
  // "main" UI; screens before it (splash/ad/login/onboarding) are pre-main.
  // Each tab is a top-level entry explored as its own DFS section root.
  let tabBar: TabItem[] | undefined;
  let mainReached = false;
  // True when the launch screen itself shows the tab bar (no pre-main gate) —
  // then each tab is entered from the entry by relaunching, so every tab is a
  // direct child of the app entry rather than of the last section's screen.
  let entryHasTabBar = false;
  let currentSection: string | undefined;
  // Title to stamp on the next screen we land on (a tab's home → the tab label).
  let pendingTabTitle: string | undefined;
  // After relaunching to the entry, the tab to tap from the entry screen.
  let pendingTabSwitch: TabItem | undefined;
  const tabsVisited = new Set<string>();
  const preMainNodes: string[] = [];
  // Every tab selector ever detected, and each node's interactable keys — so we
  // can back-fill phase: a "pre-main" screen that actually shows the tab bar
  // (detection just missed it on its frames) is reclassified as main.
  const tabSelKeysSeen = new Set<string>();
  const interactablesByNode = new Map<string, Set<string>>();

  // Probe for the bottom tab bar before exploring. The tabbed main UI can take
  // a beat to render after launch; if we miss it on the first frame we'd treat
  // a tab as an ordinary button and hop between sections. Once found, every tab
  // is excluded from free exploration and each becomes its own section root.
  for (let probe = 0; probe < 3 && !mainReached; probe++) {
    await driver.waitForIdle();
    const probed = detectTabBar(await driver.uiTree());
    if (probed) {
      tabBar = probed;
      mainReached = true;
      entryHasTabBar = true; // launch screen is the tabbed root
      for (const t of probed) tabSelKeysSeen.add(selectorKey(t.selector));
      currentSection = probed[0]?.label; // launch lands on the first tab's home
      pendingTabTitle = probed[0]?.label;
      if (probed[0]) tabsVisited.add(tabKey(probed[0]));
      log(`launch UI has a tab bar — ${probed.length} tabs: ${probed.map((t) => t.label).join(', ')}; each tab is a section`);
    } else if (probe < 2) {
      await sleep(250);
    }
  }

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
      // Dump the raw UI tree alongside the screenshot — invaluable for debugging
      // detection (e.g. why a tab bar was missed on a given screen).
      try {
        await mkdir(join(opts.outDir, 'trees'), { recursive: true });
        await writeFile(join(opts.outDir, 'trees', `step_${step}.json`), JSON.stringify(tree));
      } catch {
        /* best-effort debug artifact */
      }
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

    // Detect the bottom tab bar. The first screen that has one is the tabbed
    // main UI; from there each tab is a top-level section root (handled below).
    const tabsHere = detectTabBar(tree);
    if (tabsHere) {
      tabBar = tabsHere;
      for (const t of tabsHere) tabSelKeysSeen.add(selectorKey(t.selector));
      if (!mainReached) {
        // First tabbed screen reached mid-run (e.g. after login) — it's the
        // first tab's home; name it after that tab and mark the tab visited.
        mainReached = true;
        currentSection = tabsHere[0]?.label;
        if (tabsHere[0]) tabsVisited.add(tabKey(tabsHere[0]));
        if (tabsHere[0]?.label) graph.setTitle(nodeId, tabsHere[0].label);
        log(`[${step}] ${nodeId} reached tabbed main UI — ${tabsHere.length} tabs: ${tabsHere.map((t) => t.label).join(', ')}`);
      }
      graph.notePattern(nodeId, { kind: 'tabbar' });
    }
    if (mainReached) {
      graph.markPhase(nodeId, 'main');
      if (currentSection) graph.markSection(nodeId, currentSection);
    } else {
      // Provisional: only committed as pre-main if a tab bar is ever reached.
      // Apps with no tab bar are free-explored and carry no phase at all.
      preMainNodes.push(nodeId);
    }

    // A `back` that left us on the same screen is a modal eating the gesture
    // (e.g. a "discard changes?" dialog). Don't keep backing into it.
    const backWasNoOp = pending?.action.kind === 'back' && pending.fromId === nodeId;
    // A scroll that left us on the SAME node = nothing new scrolled into view:
    // we're at the bottom, or it's an infinite feed whose structure repeats
    // (content-invariant fingerprint). Either way, stop scrolling this screen.
    if (pending?.action.kind === 'scroll' && pending.fromId === nodeId) scrollExhausted.add(nodeId);
    sameNodeStreak = nodeId === lastObservedNodeId ? sameNodeStreak + 1 : 0;
    lastObservedNodeId = nodeId;

    if (pending) {
      graph.recordAction(pending.fromId, pending.action, nodeId);
      // Record where this button actually went (first destination wins).
      if (pending.signature && !destinationOf.has(pending.signature)) {
        destinationOf.set(pending.signature, nodeId);
      }
      pending = undefined;
    }

    // We just landed on a tab's home screen — name it after the tab ("Home",
    // "Explore", …) instead of the generic top-text guess.
    if (pendingTabTitle) {
      graph.setTitle(nodeId, pendingTabTitle);
      pendingTabTitle = undefined;
    }

    // Just relaunched to the app entry to enter the next tab — tap it from here,
    // so the edge is entry → tab (each tab a direct child of the entry).
    if (pendingTabSwitch) {
      const tab = pendingTabSwitch;
      pendingTabSwitch = undefined;
      currentSection = tab.label;
      pendingTabTitle = tab.label;
      graph.markTried(nodeId, tab.selector);
      log(`[${step}] entering tab "${tab.label}" from entry ${nodeId}`);
      await driver.tap(tab.center);
      pending = {
        fromId: nodeId,
        action: { kind: 'tap', selector: tab.selector, point: tab.center },
        signature: signatureOf(tab.selector),
      };
      history.push(`${guessTitle(tree) ?? nodeId} → tab ${tab.label}`);
      await driver.waitForIdle();
      continue;
    }

    if (sameNodeStreak >= 12) {
      log(`[${step}] stuck on one screen for ${sameNodeStreak} steps — stopping`);
      break;
    }

    if (opts.shouldStop?.(graph.counts)) {
      log(`[${step}] external stop condition — stopping`);
      break;
    }

    const screenHeight = tree.bounds?.h ?? 2400;
    const interactables = collectInteractables(tree);
    let nodeKeys = interactablesByNode.get(nodeId);
    if (!nodeKeys) {
      nodeKeys = new Set();
      interactablesByNode.set(nodeId, nodeKeys);
    }
    for (const i of interactables) {
      graph.noteInteractable(nodeId, i.selector);
      nodeKeys.add(selectorKey(i.selector));
    }
    const editableFields = interactables.filter((i) => i.editable);

    // Build scored candidates from untried interactables, pruning recurring
    // buttons whose destination is already fully explored (the scanner trap).
    const untriedKeys = new Set(graph.untried(nodeId).map((s) => selectorKey(s)));
    const title = guessTitle(tree);

    // Forms first (deterministic, ahead of the decider): a multi-field form
    // gets every text field filled before anything taps submit — otherwise
    // validation fails on empties and backing out pops a "discard changes?"
    // dialog (the iHerb address-form trap).
    //
    // Real-world quirks handled (learned from iHerb): dropdowns render as
    // non-focusable EditText → excluded by isEditable; every field can share
    // one resourceId → dedup by the field's CURRENT TEXT (a filled field shows
    // our typed value), not by selector; fields below the fold are reached by
    // scrolling. We NEVER press a bare back() here — only dismissKeyboard
    // (safe), so the form is never accidentally navigated away.
    const untriedEditable = editableFields.filter((f) => untriedKeys.has(selectorKey(f.selector)));
    if (editableFields.length >= 2 && untriedEditable.length > 0) {
      const first = editableFields[0]!;
      const typedValues = new Set<string>();
      let totalFilled = 0;
      for (let pass = 0; pass < 5; pass++) {
        const fields = (pass === 0 ? interactables : collectInteractables(await driver.uiTree())).filter(
          (i) => i.editable,
        );
        // Unfilled = current text isn't a value we've already typed.
        const fresh = fields.filter((f) => !(f.text && typedValues.has(f.text)));
        if (fresh.length === 0) break;
        for (const f of fresh) {
          graph.markTried(nodeId, f.selector);
          const value = synthesizeInput(f.hint);
          await driver.dismissKeyboard(); // clean layout before tapping next field (safe)
          await driver.tap(f.center);
          await driver.waitForIdle();
          await driver.clearText();
          await driver.type(value);
          typedValues.add(value);
          totalFilled += 1;
        }
        await driver.dismissKeyboard();
        const h = tree.bounds?.h ?? 2400;
        const w = tree.bounds?.w ?? 1080;
        await driver.swipe({ x: w / 2, y: h * 0.72 }, { x: w / 2, y: h * 0.3 }, 400);
        await driver.waitForIdle();
      }
      log(`[${step}] ${nodeId} filled ${totalFilled} text field(s)`);

      // Dropdowns (Country / State): tap to open the picker, wait for it to
      // load (often a network request), pick the first real option, return.
      const dropdowns = collectInteractables(await driver.uiTree()).filter((i) => i.dropdown);
      let pickedCount = 0;
      for (const dd of dropdowns) {
        await driver.dismissKeyboard();
        await driver.tap(dd.center);
        await waitForStableTree(() => driver.uiTree(), { maxMs: 6000 });
        const option = pickFirstOption(await driver.uiTree());
        if (option) {
          await driver.tap(option);
          await waitForStableTree(() => driver.uiTree(), { maxMs: 4000 });
          pickedCount += 1;
        } else {
          await driver.dismissKeyboard(); // nothing pickable; leave the picker
        }
      }
      if (pickedCount > 0) log(`[${step}] ${nodeId} selected ${pickedCount} dropdown(s)`);

      pending = {
        fromId: nodeId,
        action: { kind: 'type', selector: first.selector, point: first.center, inputValue: '(form)' },
        signature: signatureOf(first.selector),
      };
      history.push(`${title ?? nodeId} → fill form (${totalFilled} fields, ${pickedCount} dropdowns)`);
      consecutiveBacks = 0;
      await driver.waitForIdle();
      continue;
    }

    const candidates: Candidate[] = [];
    for (const cand of interactables) {
      if (!untriedKeys.has(selectorKey(cand.selector))) continue;
      // Tabs are top-level entries driven explicitly (one section at a time),
      // never tapped as ordinary candidates — otherwise free exploration would
      // hop from one bar to another. Excluded by the accumulated tab-selector
      // set, so this holds even on a screen where detection missed the bar.
      if (tabSelKeysSeen.has(selectorKey(cand.selector))) {
        graph.markTried(nodeId, cand.selector);
        continue;
      }
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
        dropdown: cand.dropdown,
        text: cand.text,
        yFraction: Math.round((cand.center.y / screenHeight) * 100) / 100,
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

    // back is being eaten by a modal — stop backing, tap a candidate to escape
    // (e.g. "Leave" on a discard dialog).
    if (decision.act === 'back' && backWasNoOp) {
      if (candidates.length > 0) {
        const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
        decision = best.editable
          ? { act: 'type', index: best.index, reason: 'back trapped by a modal; interacting to escape' }
          : { act: 'tap', index: best.index, reason: 'back trapped by a modal; tapping to escape' };
      } else if (graph.hasAnyUntried() && consecutiveRelaunches < 3) {
        // Trapped on a modal with nothing to tap (e.g. a wheel-picker sheet that
        // exposes no clickable items and eats back), but there's still untried
        // frontier elsewhere. Don't kill the run — relaunch to a known state and
        // keep exploring (tried-state persists, so we won't redo this path).
        consecutiveRelaunches += 1;
        log(`[${step}] ${nodeId} trapped modal w/ no candidates — relaunching ${opts.appId} to continue`);
        await driver.launch(opts.appId);
        pending = undefined;
        await driver.waitForIdle();
        continue;
      } else {
        decision = { act: 'stop', reason: graph.hasAnyUntried() ? 'trapped; relaunch budget exhausted' : 'trapped; nothing left to explore' };
      }
    }

    // Before leaving an exhausted-but-scrollable screen, scroll down to reveal
    // below-the-fold content. Bounded: at most MAX_SCROLLS_PER_SCREEN per
    // screen, and we stop the moment a scroll changes nothing (bottom reached,
    // or an infinite feed whose structure repeats → same fingerprint → marked
    // scrollExhausted on the next observe).
    const scrolls = scrollsByNode.get(nodeId) ?? 0;
    if (
      decision.act === 'back' &&
      candidates.length === 0 &&
      hasScrollable(tree) &&
      !scrollExhausted.has(nodeId) &&
      scrolls < MAX_SCROLLS_PER_SCREEN
    ) {
      scrollsByNode.set(nodeId, scrolls + 1);
      const h = tree.bounds?.h ?? 2400;
      const w = tree.bounds?.w ?? 1080;
      log(`[${step}] ${nodeId} exhausted — scroll down (${scrolls + 1}/${MAX_SCROLLS_PER_SCREEN})`);
      await driver.swipe({ x: w / 2, y: h * 0.75 }, { x: w / 2, y: h * 0.3 }, 400);
      pending = { fromId: nodeId, action: { kind: 'scroll', direction: 'down' } };
      consecutiveBacks = 0;
      await driver.waitForIdle();
      continue;
    }

    // Tabbar-aware: once the tabbed main UI is reached, every bar is a top-level
    // entry. When the decider would back out of (or stop on) an exhausted
    // section, jump to the next unvisited tab instead — so each section is
    // explored as its own DFS root before the run ends.
    // The current screen shows the tab bar if detection found it, or (when
    // detection missed it) if this node's interactables include ≥2 known tabs.
    const screenShowsTabBar =
      tabsHere !== undefined ||
      (nodeKeys ? [...tabSelKeysSeen].filter((k) => nodeKeys!.has(k)).length >= 2 : false);
    if (mainReached && tabBar && screenShowsTabBar && (decision.act === 'back' || decision.act === 'stop')) {
      const nextTab = tabBar.find((t) => !tabsVisited.has(tabKey(t)));
      if (nextTab) {
        tabsVisited.add(tabKey(nextTab));
        consecutiveBacks = 0;
        if (entryHasTabBar) {
          // Enter the tab from the app entry: relaunch to the tabbed root, then
          // tap the tab from there (next loop) so it's a direct child of the
          // entry — not of whatever screen this section happened to end on.
          log(`[${step}] section "${currentSection ?? ''}" done — relaunch & enter "${nextTab.label}" from the app entry`);
          pendingTabSwitch = nextTab;
          pending = undefined;
          await driver.launch(opts.appId);
          await driver.waitForIdle();
          continue;
        }
        // Pre-main-gated app: relaunch wouldn't land on the tabs, so switch from
        // the current screen (best-effort until pre-main replay lands).
        currentSection = nextTab.label;
        pendingTabTitle = nextTab.label;
        graph.markTried(nodeId, nextTab.selector);
        log(`[${step}] ${nodeId} section done — switch to tab "${nextTab.label}"`);
        await driver.tap(nextTab.center);
        pending = {
          fromId: nodeId,
          action: { kind: 'tap', selector: nextTab.selector, point: nextTab.center },
          signature: signatureOf(nextTab.selector),
        };
        history.push(`${title ?? nodeId} → tab ${nextTab.label}`);
        await driver.waitForIdle();
        continue;
      }
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
        await driver.clearText();
        await driver.type(value);
        await driver.pressEnter();
        await driver.dismissKeyboard();
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

  // Commit phase tags only if a tabbed main UI was found (no tab bar → free
  // exploration, no phase concept). A "pre-main" candidate that actually shows
  // the tab bar — detection just missed it on this screen's frames — is really
  // a main screen; reclassify it by checking its interactables against every
  // tab selector we ever saw.
  if (mainReached) {
    const firstTabLabel = tabBar?.[0]?.label;
    for (const id of preMainNodes) {
      const keys = interactablesByNode.get(id);
      const tabHits = keys ? [...tabSelKeysSeen].filter((k) => keys.has(k)).length : 0;
      if (tabHits >= 2) {
        graph.markPhase(id, 'main');
        graph.notePattern(id, { kind: 'tabbar' });
        // The launch landing is the first tab's home — name it after that tab.
        if (id === launchNodeId && firstTabLabel) {
          graph.setTitle(id, firstTabLabel);
          graph.markSection(id, firstTabLabel);
        }
      } else {
        graph.markPhase(id, 'pre-main');
      }
    }
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
    const dropdown = isDropdown(node);
    if ((node.clickable || editable) && node.enabled !== false && b && b.w > 0 && b.h > 0) {
      out.push({
        selector: toSelector(node, path),
        center: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        editable,
        dropdown,
        // Include the visible text/label: many apps reuse one resourceId for
        // every field, so the label is the only thing that tells them apart
        // (and lets synthesizeInput match "Full Name" → a name).
        hint: `${node.resourceId ?? ''} ${node.contentDesc ?? ''} ${node.text ?? ''} ${node.className}`.toLowerCase(),
        text: node.text,
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
 * True text-entry widgets only — EditText / SearchView / AutoComplete that are
 * `focusable`. Apps often render dropdowns (Country/State) as a non-focusable
 * EditText that opens a picker on tap; those are NOT typeable, so they're left
 * as normal tap candidates (`focusable=false` → excluded here).
 */
function isEditable(node: UiNode): boolean {
  if (node.focusable === false) return false;
  const cls = node.className.toLowerCase();
  return cls.includes('edittext') || cls.includes('searchview') || cls.includes('autocomplete');
}

/**
 * A select/dropdown: a Spinner, or a field-like widget that opens a picker on
 * tap rather than accepting text (iHerb renders Country/State as a
 * non-focusable EditText). Tapping it should pick an option, not type.
 */
function isDropdown(node: UiNode): boolean {
  const cls = node.className.toLowerCase();
  if (cls.includes('spinner')) return true;
  return node.focusable === false && (cls.includes('edittext') || cls.includes('autocomplete'));
}

/**
 * Pick the best option on an open picker/list: a clickable leaf with real text,
 * skipping search boxes, headers and dismiss controls. Returns its tap point.
 */
export function pickFirstOption(root: UiNode): { x: number; y: number } | undefined {
  const screenH = root.bounds?.h ?? 2400;
  const opts: Array<{ x: number; y: number; text: string }> = [];
  const walk = (n: UiNode): void => {
    const b = n.bounds;
    const text = (n.text ?? n.contentDesc ?? '').trim();
    const isLeaf = n.children.length === 0;
    if (n.clickable && isLeaf && b && b.w > 0 && b.h > 0 && text.length >= 2 && text.length <= 40) {
      if (!/\b(cancel|close|done|back|search|select|clear|ok)\b|^[x✕✖]$/i.test(text)) {
        opts.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, text });
      }
    }
    n.children.forEach(walk);
  };
  walk(root);
  // Skip the very top (likely a title/search bar); take the first real option.
  const pick = opts.find((o) => o.y > screenH * 0.12) ?? opts[0];
  return pick ? { x: pick.x, y: pick.y } : undefined;
}

/** Poll the UI tree until its structure stops changing (or timeout) — for network-loaded pickers. */
async function waitForStableTree(
  getTree: () => Promise<UiNode>,
  opts: { settleMs?: number; maxMs?: number } = {},
): Promise<UiNode> {
  const settleMs = opts.settleMs ?? 500;
  const maxMs = opts.maxMs ?? 5000;
  const start = Date.now();
  let prev = '';
  let tree = await getTree();
  while (Date.now() - start < maxMs) {
    const fp = fingerprint(tree);
    if (fp === prev) return tree;
    prev = fp;
    await sleep(settleMs);
    tree = await getTree();
  }
  return tree;
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
