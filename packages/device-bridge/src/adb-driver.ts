import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  /** Boot an emulator if no device is connected (default true). */
  autoBoot?: boolean;
  /** AVD name to boot; default OAS_ANDROID_AVD env, else the first listed AVD. */
  avd?: string;
  /** Emulator binary; default OAS_EMULATOR_PATH or $ANDROID_HOME/emulator/emulator. */
  emulatorPath?: string;
  /** Max time to wait for the emulator to finish booting (default 240s; cold boots are slow). */
  bootTimeoutMs?: number;
  /** Progress log (boot can take a minute). */
  log?: (message: string) => void;
}

/** Explicit option → OAS_ADB_PATH → $ANDROID_HOME/platform-tools/adb → "adb" on PATH. */
function resolveAdbPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.OAS_ADB_PATH) return process.env.OAS_ADB_PATH;
  const sdkHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdkHome) {
    const candidate = join(sdkHome, 'platform-tools', 'adb');
    if (existsSync(candidate)) return candidate;
  }
  return 'adb';
}

/** $ANDROID_HOME/emulator/emulator, else OAS_EMULATOR_PATH, else "emulator". */
function resolveEmulatorPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.OAS_EMULATOR_PATH) return process.env.OAS_EMULATOR_PATH;
  const sdkHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdkHome) {
    const candidate = join(sdkHome, 'emulator', 'emulator');
    if (existsSync(candidate)) return candidate;
  }
  return 'emulator';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Android driver over plain adb — no on-device agent required. */
export class AdbDriver implements DeviceDriver {
  private readonly adb: string;
  private readonly baseArgs: string[];
  private readonly settleMs: number;
  private readonly autoBoot: boolean;
  private readonly avd?: string;
  private readonly emulatorPath: string;
  private readonly bootTimeoutMs: number;
  private readonly log: (message: string) => void;

  constructor(opts: AdbDriverOptions = {}) {
    this.adb = resolveAdbPath(opts.adbPath);
    this.baseArgs = opts.serial ? ['-s', opts.serial] : [];
    this.settleMs = opts.settleMs ?? 1000;
    this.autoBoot = opts.autoBoot ?? true;
    this.avd = opts.avd ?? process.env.OAS_ANDROID_AVD;
    this.emulatorPath = resolveEmulatorPath(opts.emulatorPath);
    this.bootTimeoutMs = opts.bootTimeoutMs ?? 240_000;
    this.log = opts.log ?? (() => {});
  }

  private async run(args: string[], opts: { binary?: boolean } = {}): Promise<Buffer> {
    try {
      const { stdout } = await execFileAsync(this.adb, [...this.baseArgs, ...args], {
        encoding: 'buffer' as const,
        maxBuffer: 64 * 1024 * 1024,
      });
      return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        throw new Error(
          `adb not found at "${this.adb}" — set ANDROID_HOME (or OAS_ADB_PATH) in .env, or add platform-tools to PATH`,
        );
      }
      throw err;
    }
  }

  /** Ensure a device is online, booting an emulator first if autoBoot is set. */
  async ensureDevice(): Promise<boolean> {
    let state = (await this.run(['get-state']).catch(() => Buffer.from(''))).toString('utf8').trim();
    if (state !== 'device' && this.autoBoot) {
      await this.bootEmulator();
      state = (await this.run(['get-state']).catch(() => Buffer.from(''))).toString('utf8').trim();
    }
    return state === 'device';
  }

  /** Fails fast with actionable messages before exploration starts. */
  async preflight(appId: string): Promise<void> {
    if (!(await this.ensureDevice())) {
      throw new Error(
        'No Android device/emulator connected (adb get-state). Start one, e.g.: emulator -avd oas-test',
      );
    }
    const packages = (await this.run(['shell', 'pm', 'list', 'packages', appId])).toString('utf8');
    const installed = packages.split('\n').some((l) => l.trim() === `package:${appId}`);
    if (!installed) {
      throw new Error(
        `${appId} is not installed on the device. OAS explores INSTALLED apps — it does not download from app stores. ` +
          `Install it first (adb install <file.apk>), then start the run again.`,
      );
    }
  }

  /** List installed AVDs via the emulator binary. */
  private async listAvds(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(this.emulatorPath, ['-list-avds'], { encoding: 'utf8' });
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Boot an emulator and wait for Android to finish booting (best-effort). */
  private async bootEmulator(): Promise<void> {
    const avds = await this.listAvds();
    if (avds.length === 0) {
      this.log(`no AVDs found via "${this.emulatorPath} -list-avds" — cannot auto-boot`);
      return;
    }
    const avd = this.avd && avds.includes(this.avd) ? this.avd : avds[0]!;
    this.log(`no device connected — booting emulator "${avd}" (a cold boot can take 1-3 min)…`);

    const child = spawn(this.emulatorPath, ['-avd', avd, '-no-snapshot-save', '-no-boot-anim'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    const deadline = Date.now() + this.bootTimeoutMs;
    // Wait for the device to attach, then for sys.boot_completed.
    while (Date.now() < deadline) {
      const state = (await this.run(['get-state']).catch(() => Buffer.from(''))).toString('utf8').trim();
      if (state === 'device') {
        const booted = (await this.run(['shell', 'getprop', 'sys.boot_completed']).catch(() => Buffer.from('')))
          .toString('utf8')
          .trim();
        if (booted === '1') {
          this.log(`emulator "${avd}" booted`);
          await this.run(['shell', 'input', 'keyevent', '82']).catch(() => {}); // dismiss keyguard
          return;
        }
      }
      await sleep(2000);
    }
    this.log(`emulator "${avd}" did not finish booting within ${Math.round(this.bootTimeoutMs / 1000)}s`);
  }

  async launch(appId: string): Promise<void> {
    await this.preflight(appId);
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
      // `-S` force-stops the app before starting, so an already-running app is
      // cold-started back to its entry screen rather than just brought to the
      // foreground at whatever deep screen it was on. Essential for tab-driven
      // exploration: each tab must be entered from a fresh Home, not from the
      // page the previous section happened to end on.
      await this.run([
        'shell', 'am', 'start', '-S',
        '-a', 'android.intent.action.MAIN',
        '-c', 'android.intent.category.LAUNCHER',
        '-n', resolved,
      ]);
    } else {
      // No resolvable launcher activity — force-stop then launch via monkey.
      await this.run(['shell', 'am', 'force-stop', appId]).catch(() => undefined);
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

  async clearText(): Promise<void> {
    // `input text` APPENDS — without clearing, re-typing a field yields
    // "testtest". Move to end, then send a batch of DELs to wipe existing text.
    await this.run(['shell', 'input', 'keyevent', '123']); // KEYCODE_MOVE_END
    const dels = Array.from({ length: 60 }, () => '67'); // KEYCODE_DEL ×60
    await this.run(['shell', 'input', 'keyevent', ...dels]);
  }

  async pressEnter(): Promise<void> {
    await this.run(['shell', 'input', 'keyevent', '66']); // KEYCODE_ENTER
  }

  async isKeyboardShown(): Promise<boolean> {
    const ime = (await this.run(['shell', 'dumpsys', 'input_method']).catch(() => Buffer.from('')))
      .toString('utf8');
    return /mInputShown=true/.test(ime);
  }

  async dismissKeyboard(): Promise<void> {
    // Only back when the IME is actually shown — otherwise back() navigates and
    // can pop a "discard changes?" dialog (the address-form trap).
    if (await this.isKeyboardShown()) {
      await this.run(['shell', 'input', 'keyevent', '4']); // KEYCODE_BACK closes the keyboard
    }
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
