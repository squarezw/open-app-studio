import type { Point, UiNode } from '@oas/flow-graph';
import { parseAppiumSource } from './parse-uiautomator.js';
import type { DeviceDriver } from './types.js';

/**
 * Appium (UiAutomator2) backend, spoken over the W3C/Appium HTTP API with
 * plain fetch — no heavy SDK, matching the zero-dep style of AdbDriver.
 *
 * Why it can beat raw adb on OAS's pain cases:
 *  - element-level clear()+value() → text REPLACE (no `input text` append bug);
 *  - built-in is_keyboard_shown / hide_keyboard;
 *  - page source is the same UiAutomator XML we already parse;
 *  - a persistent on-device agent → much faster tree reads than `uiautomator dump`.
 *
 * Requires a running Appium server with the uiautomator2 driver:
 *   npm i -g appium && appium driver install uiautomator2 && appium
 */
export interface AppiumDriverOptions {
  /** Appium server base URL. */
  baseUrl?: string;
  /** Device serial → appium:udid. */
  serial?: string;
  settleMs?: number;
  log?: (message: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W3C_ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export class AppiumDriver implements DeviceDriver {
  private readonly baseUrl: string;
  private readonly serial?: string;
  private readonly settleMs: number;
  private readonly log: (m: string) => void;
  private sessionId?: string;

  constructor(opts: AppiumDriverOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:4723').replace(/\/$/, '');
    this.serial = opts.serial;
    this.settleMs = opts.settleMs ?? 600;
    this.log = opts.log ?? (() => {});
  }

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).catch((err) => {
      throw new Error(`Appium server unreachable at ${this.baseUrl} — is it running? (${String(err)})`);
    });
    const json = (await res.json().catch(() => ({}))) as { value?: unknown };
    if (!res.ok) {
      const v = json.value as { message?: string } | undefined;
      throw new Error(`Appium ${method} ${path} → HTTP ${res.status}: ${v?.message ?? JSON.stringify(json)}`);
    }
    return json.value;
  }

  /** Lazily create a UiAutomator2 session attached to whatever app is running. */
  private async session(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const value = (await this.req('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:newCommandTimeout': 600,
          'appium:autoLaunch': false, // attach; we drive launch() ourselves
          'appium:noReset': true,
          ...(this.serial ? { 'appium:udid': this.serial } : {}),
        },
      },
    })) as { sessionId: string };
    this.sessionId = value.sessionId;
    this.log(`appium session ${this.sessionId}`);
    return this.sessionId;
  }

  private async s(path: string): Promise<string> {
    return `/session/${await this.session()}${path}`;
  }

  async launch(appId: string): Promise<void> {
    await this.req('POST', await this.s('/appium/device/activate_app'), { appId });
    await this.waitForIdle(this.settleMs * 2);
  }

  async screenshot(outPath: string): Promise<string> {
    const b64 = (await this.req('GET', await this.s('/screenshot'))) as string;
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, Buffer.from(b64, 'base64'));
    return outPath;
  }

  async uiTree(): Promise<UiNode> {
    const xml = (await this.req('GET', await this.s('/source'))) as string;
    return parseAppiumSource(xml);
  }

  async tap(point: Point): Promise<void> {
    await this.pointer([
      { type: 'pointerMove', duration: 0, x: Math.round(point.x), y: Math.round(point.y) },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 60 },
      { type: 'pointerUp', button: 0 },
    ]);
  }

  async swipe(from: Point, to: Point, durationMs = 300): Promise<void> {
    await this.pointer([
      { type: 'pointerMove', duration: 0, x: Math.round(from.x), y: Math.round(from.y) },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: durationMs, x: Math.round(to.x), y: Math.round(to.y) },
      { type: 'pointerUp', button: 0 },
    ]);
  }

  private async pointer(actions: unknown[]): Promise<void> {
    const path = await this.s('/actions');
    await this.req('POST', path, {
      actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions }],
    });
    await this.req('DELETE', path).catch(() => {});
  }

  /** W3C element id of the currently-focused element, if any. */
  private async activeElementId(): Promise<string | undefined> {
    const value = (await this.req('GET', await this.s('/element/active')).catch(() => undefined)) as
      | Record<string, string>
      | undefined;
    return value?.[W3C_ELEMENT];
  }

  async type(text: string): Promise<void> {
    const eid = await this.activeElementId();
    if (eid) await this.req('POST', await this.s(`/element/${eid}/value`), { text });
  }

  async clearText(): Promise<void> {
    // Element-level clear truly replaces — no `input text` append bug.
    const eid = await this.activeElementId();
    if (eid) await this.req('POST', await this.s(`/element/${eid}/clear`)).catch(() => {});
  }

  async pressEnter(): Promise<void> {
    await this.req('POST', await this.s('/appium/device/press_keycode'), { keycode: 66 });
  }

  async isKeyboardShown(): Promise<boolean> {
    return Boolean(await this.req('GET', await this.s('/appium/device/is_keyboard_shown')).catch(() => false));
  }

  async dismissKeyboard(): Promise<void> {
    if (await this.isKeyboardShown()) {
      await this.req('POST', await this.s('/appium/device/hide_keyboard')).catch(() => {});
    }
  }

  async back(): Promise<void> {
    await this.req('POST', await this.s('/back'));
  }

  async deepLink(url: string): Promise<void> {
    await this.req('POST', await this.s('/url'), { url }).catch(() => {});
  }

  async routeHint(): Promise<string | undefined> {
    const pkg = (await this.req('GET', await this.s('/appium/device/current_package')).catch(() => undefined)) as
      | string
      | undefined;
    const act = (await this.req('GET', await this.s('/appium/device/current_activity')).catch(() => undefined)) as
      | string
      | undefined;
    if (!pkg) return undefined;
    return act ? `${pkg}/${act}` : pkg;
  }

  async waitForIdle(ms = this.settleMs): Promise<void> {
    await sleep(ms);
  }

  /** End the Appium session (optional cleanup). */
  async close(): Promise<void> {
    if (this.sessionId) {
      await this.req('DELETE', `/session/${this.sessionId}`).catch(() => {});
      this.sessionId = undefined;
    }
  }
}
