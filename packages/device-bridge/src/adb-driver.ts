import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { Point, UiNode } from '@oas/flow-graph';
import { parseUiautomatorXml } from './parse-uiautomator.js';
import type { DeviceDriver } from './types.js';

const execFileAsync = promisify(execFile);

export interface AdbDriverOptions {
  /** Device serial (`adb -s`); omit when exactly one device is attached. */
  serial?: string;
  adbPath?: string;
  /** Default settle time after actions, ms. */
  settleMs?: number;
}

/** Android driver over plain adb — no on-device agent required. */
export class AdbDriver implements DeviceDriver {
  private readonly adb: string;
  private readonly baseArgs: string[];
  private readonly settleMs: number;

  constructor(opts: AdbDriverOptions = {}) {
    this.adb = opts.adbPath ?? 'adb';
    this.baseArgs = opts.serial ? ['-s', opts.serial] : [];
    this.settleMs = opts.settleMs ?? 1000;
  }

  private async run(args: string[], opts: { binary?: boolean } = {}): Promise<Buffer> {
    const { stdout } = await execFileAsync(this.adb, [...this.baseArgs, ...args], {
      encoding: opts.binary ? ('buffer' as const) : ('buffer' as const),
      maxBuffer: 64 * 1024 * 1024,
    });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  }

  async launch(appId: string): Promise<void> {
    // `monkey -p <pkg> 1` is the classic launcher but exits non-zero on recent
    // emulator images (SYS_KEYS warning → exit 251). Resolve the launcher
    // activity and `am start` it instead; fall back to monkey for packages
    // without a LAUNCHER intent.
    const resolved = (
      await this.run([
        'shell', 'cmd', 'package', 'resolve-activity', '--brief',
        '-c', 'android.intent.category.LAUNCHER', appId,
      ]).catch(() => Buffer.from(''))
    )
      .toString('utf8')
      .trim()
      .split('\n')
      .pop()
      ?.trim();

    if (resolved?.includes('/')) {
      await this.run([
        'shell', 'am', 'start',
        '-a', 'android.intent.action.MAIN',
        '-c', 'android.intent.category.LAUNCHER',
        '-n', resolved,
      ]);
    } else {
      await this.run(['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']);
    }
    await this.waitForIdle(this.settleMs * 2);
  }

  async screenshot(outPath: string): Promise<string> {
    const png = await this.run(['exec-out', 'screencap', '-p'], { binary: true });
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, png);
    return outPath;
  }

  async uiTree(): Promise<UiNode> {
    await this.run(['shell', 'uiautomator', 'dump', '/sdcard/oas_window_dump.xml']);
    const xml = (await this.run(['exec-out', 'cat', '/sdcard/oas_window_dump.xml'])).toString('utf8');
    return parseUiautomatorXml(xml);
  }

  async tap(point: Point): Promise<void> {
    await this.run(['shell', 'input', 'tap', String(Math.round(point.x)), String(Math.round(point.y))]);
  }

  async swipe(from: Point, to: Point, durationMs = 300): Promise<void> {
    await this.run([
      'shell', 'input', 'swipe',
      String(Math.round(from.x)), String(Math.round(from.y)),
      String(Math.round(to.x)), String(Math.round(to.y)),
      String(durationMs),
    ]);
  }

  async type(text: string): Promise<void> {
    // `input text` cannot express spaces directly; %s is its escape for space.
    await this.run(['shell', 'input', 'text', text.replace(/ /g, '%s')]);
  }

  async back(): Promise<void> {
    await this.run(['shell', 'input', 'keyevent', '4']);
  }

  async deepLink(url: string): Promise<void> {
    await this.run(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
  }

  async routeHint(): Promise<string | undefined> {
    const out = (await this.run(['shell', 'dumpsys', 'activity', 'activities'])).toString('utf8');
    const m = /mResumedActivity:.*?\s([\w.]+\/[\w.$]+)/.exec(out) ?? /topResumedActivity.*?\s([\w.]+\/[\w.$]+)/.exec(out);
    return m?.[1];
  }

  async waitForIdle(ms = this.settleMs): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
