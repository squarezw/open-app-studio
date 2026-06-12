import type { Point, UiNode } from '@oas/flow-graph';

/**
 * The uniform capability set agents see, regardless of backend
 * (adb, Maestro, Appium/WDA). One instance == one device session.
 */
export interface DeviceDriver {
  /** Launch (or foreground) the app by bundle id / package name. */
  launch(appId: string): Promise<void>;
  /** Capture a screenshot to `outPath`; resolves to the written path. */
  screenshot(outPath: string): Promise<string>;
  /** Dump the current UI element tree, normalized to UiNode. */
  uiTree(): Promise<UiNode>;
  tap(point: Point): Promise<void>;
  swipe(from: Point, to: Point, durationMs?: number): Promise<void>;
  type(text: string): Promise<void>;
  /** Clear the focused text field (so typing replaces rather than appends). */
  clearText(): Promise<void>;
  /** Submit the focused input (IME action / Enter), e.g. to run a search. */
  pressEnter(): Promise<void>;
  /** Whether the soft keyboard is currently shown (a tapped field accepts text). */
  isKeyboardShown(): Promise<boolean>;
  /** Close the soft keyboard IF it is open — must NOT navigate when it's already closed. */
  dismissKeyboard(): Promise<void>;
  back(): Promise<void>;
  deepLink(url: string): Promise<void>;
  /** Platform route hint for the current screen (activity name, etc.). */
  routeHint(): Promise<string | undefined>;
  /** Wait for the UI to settle after an action. */
  waitForIdle(ms?: number): Promise<void>;
}
