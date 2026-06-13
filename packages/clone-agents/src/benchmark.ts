import type { DeviceDriver } from '@oas/device-bridge';
import { fingerprint, type UiNode } from '@oas/flow-graph';
import { collectInteractables } from './heuristic-explorer.js';

/**
 * Phase-0 device-backend benchmark — the "decision instrument" from the device
 * backend research. Runs a fixed suite of OAS's known reliability pain cases
 * against ANY DeviceDriver and emits a scorecard, so we can compare the raw-adb
 * driver against an Appium/MCP adapter head-to-head on the SAME screen.
 *
 * Probes run on the CURRENT screen — navigate the device to a representative
 * screen (e.g. an address form with text fields + dropdowns) first, then run
 * the bench for each driver on that screen.
 */

export type ProbeStatus = 'pass' | 'fail' | 'n/a';

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  detail: string;
  ms?: number;
}

export interface Scorecard {
  screen: string;
  probes: ProbeResult[];
  latencyMs: { uiTree: number; screenshot: number; tap: number };
  summary: { pass: number; fail: number; na: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** First editable text field on the current screen, if any. */
function firstEditable(tree: UiNode) {
  return collectInteractables(tree).find((i) => i.editable);
}

/** The current text value of the element nearest a point (to re-read a field after typing). */
function textNear(tree: UiNode, point: { x: number; y: number }): string | undefined {
  return collectInteractables(tree).find(
    (i) => Math.abs(i.center.x - point.x) < 30 && Math.abs(i.center.y - point.y) < 30,
  )?.text;
}

export async function runDeviceBenchmark(
  driver: DeviceDriver,
  opts: { log?: (m: string) => void; screenshotPath?: string } = {},
): Promise<Scorecard> {
  const log = opts.log ?? (() => {});
  const probes: ProbeResult[] = [];

  // — latency —
  let t = Date.now();
  let tree = await driver.uiTree();
  const uiTreeMs = Date.now() - t;
  t = Date.now();
  await driver.screenshot(opts.screenshotPath ?? '/tmp/oas-bench.png').catch(() => '');
  const screenshotMs = Date.now() - t;
  t = Date.now();
  await driver.tap({ x: 1, y: 1 });
  const tapMs = Date.now() - t;

  const screen = tree.children[0]?.className ?? tree.className;
  log(`screen: ${screen} | uiTree ${uiTreeMs}ms · screenshot ${screenshotMs}ms · tap ${tapMs}ms`);

  // — probe: duplicate resourceId (informational) —
  {
    const items = collectInteractables(tree);
    const byId = new Map<string, number>();
    for (const i of items) {
      const id = i.selector.resourceId;
      if (id) byId.set(id, (byId.get(id) ?? 0) + 1);
    }
    const worst = [...byId.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!worst || worst[1] < 2) {
      probes.push({ name: 'dup-resourceId', status: 'n/a', detail: 'no resourceId shared by ≥2 elements on this screen' });
    } else {
      probes.push({
        name: 'dup-resourceId',
        status: worst[1] >= 2 ? 'pass' : 'n/a',
        detail: `${worst[1]} elements share "${worst[0]}" — disambiguated by bounds/text (collectInteractables carries both)`,
      });
    }
  }

  // — probe: soft-keyboard detection (focus a field → shown; dismiss → hidden) —
  const field = firstEditable(tree);
  if (!field) {
    probes.push({ name: 'keyboard-detect', status: 'n/a', detail: 'no editable field on this screen' });
    probes.push({ name: 'text-replace', status: 'n/a', detail: 'no editable field on this screen' });
  } else {
    try {
      await driver.tap(field.center);
      await driver.waitForIdle();
      const shown = await driver.isKeyboardShown();
      await driver.dismissKeyboard();
      await driver.waitForIdle();
      const hidden = !(await driver.isKeyboardShown());
      probes.push({
        name: 'keyboard-detect',
        status: shown && hidden ? 'pass' : 'fail',
        detail: `focus→shown=${shown}, dismiss→hidden=${hidden}`,
      });
    } catch (err) {
      probes.push({ name: 'keyboard-detect', status: 'fail', detail: `error: ${errMsg(err)}` });
    }

    // — probe: text replace-not-append (clearText must replace, not append) —
    try {
      await driver.tap(field.center);
      await driver.waitForIdle();
      await driver.clearText();
      await driver.type('AAA');
      await driver.clearText();
      await driver.type('BBB');
      await driver.dismissKeyboard();
      await driver.waitForIdle();
      const after = textNear(await driver.uiTree(), field.center);
      const ok = after === 'BBB';
      probes.push({
        name: 'text-replace',
        status: ok ? 'pass' : 'fail',
        detail: ok ? 'field == "BBB" (replaced)' : `field == ${JSON.stringify(after)} (expected "BBB"; "AAABBB" = append bug)`,
      });
    } catch (err) {
      probes.push({ name: 'text-replace', status: 'fail', detail: `error: ${errMsg(err)}` });
    }
  }

  // — probe: scroll reveals new content (bounded) —
  {
    const before = fingerprint(tree);
    const scrollable = hasScrollable(tree);
    if (!scrollable) {
      probes.push({ name: 'scroll-coverage', status: 'n/a', detail: 'no scrollable container on this screen' });
    } else {
      const h = tree.bounds?.h ?? 2400;
      const w = tree.bounds?.w ?? 1080;
      await driver.swipe({ x: w / 2, y: h * 0.75 }, { x: w / 2, y: h * 0.3 }, 400);
      await driver.waitForIdle();
      await sleep(300);
      const after = fingerprint(await driver.uiTree());
      probes.push({
        name: 'scroll-coverage',
        status: after !== before ? 'pass' : 'n/a',
        detail: after !== before ? 'scroll revealed new structure' : 'no structural change (at bottom or repeating feed)',
      });
    }
  }

  tree = await driver.uiTree();
  const summary = {
    pass: probes.filter((p) => p.status === 'pass').length,
    fail: probes.filter((p) => p.status === 'fail').length,
    na: probes.filter((p) => p.status === 'n/a').length,
  };
  return { screen, probes, latencyMs: { uiTree: uiTreeMs, screenshot: screenshotMs, tap: tapMs }, summary };
}

export function renderScorecard(card: Scorecard, driverName: string): string {
  const lines = [
    `# Device benchmark — ${driverName}`,
    '',
    `screen: \`${card.screen}\``,
    `latency: uiTree ${card.latencyMs.uiTree}ms · screenshot ${card.latencyMs.screenshot}ms · tap ${card.latencyMs.tap}ms`,
    `result: ${card.summary.pass} pass · ${card.summary.fail} fail · ${card.summary.na} n/a`,
    '',
    '| probe | status | detail |',
    '|---|---|---|',
    ...card.probes.map((p) => `| ${p.name} | ${icon(p.status)} ${p.status} | ${p.detail} |`),
  ];
  return lines.join('\n') + '\n';
}

function icon(s: ProbeStatus): string {
  return s === 'pass' ? '✓' : s === 'fail' ? '✗' : '—';
}

function hasScrollable(node: UiNode): boolean {
  if (node.scrollable) return true;
  return node.children.some(hasScrollable);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
