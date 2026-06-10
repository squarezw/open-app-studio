/** Types mirror schemas/ifg.schema.json (version 0.1). */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Normalized UI element tree, platform-agnostic (built from uiautomator / WDA dumps). */
export interface UiNode {
  className: string;
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  bounds?: Rect;
  clickable?: boolean;
  scrollable?: boolean;
  enabled?: boolean;
  children: UiNode[];
}

export interface Selector {
  accessibilityId?: string;
  resourceId?: string;
  text?: string;
  xpath?: string;
  index?: number;
}

export type ActionKind =
  | 'tap'
  | 'longPress'
  | 'swipe'
  | 'type'
  | 'scroll'
  | 'back'
  | 'deepLink'
  | 'launch'
  | 'system';

export interface Action {
  kind: ActionKind;
  selector?: Selector;
  point?: Point;
  direction?: 'up' | 'down' | 'left' | 'right';
  inputValue?: string;
  deepLinkUrl?: string;
}

export type GuardKind = 'none' | 'loginRequired' | 'paymentBoundary' | 'destructive';

export type ScreenRole =
  | 'launch'
  | 'onboarding'
  | 'auth'
  | 'feed'
  | 'list'
  | 'detail'
  | 'form'
  | 'cart'
  | 'checkout'
  | 'settings'
  | 'profile'
  | 'search'
  | 'modal'
  | 'webview'
  | 'other';

export type PatternKind =
  | 'tabbar'
  | 'navbar'
  | 'drawer'
  | 'list'
  | 'grid'
  | 'card'
  | 'carousel'
  | 'form'
  | 'button'
  | 'input'
  | 'picker'
  | 'map'
  | 'video'
  | 'chart'
  | 'dialog'
  | 'toast'
  | 'empty'
  | 'other';

export interface ComponentPattern {
  kind: PatternKind;
  region?: Rect;
  fields?: Array<{
    label?: string;
    keyboard?: 'text' | 'email' | 'number' | 'phone' | 'password' | 'url';
    required?: boolean;
  }>;
}

export interface Evidence {
  type: 'screenshot' | 'uiTree' | 'traceEvent';
  ref: string;
  capturedAt?: string;
}

export interface ScreenNode {
  id: string;
  fingerprint: string;
  routeHint?: string;
  role?: ScreenRole;
  title?: string;
  patterns?: ComponentPattern[];
  evidence?: Evidence[];
  visits?: number;
}

export interface ActionEdge {
  id: string;
  from: string;
  to: string;
  action: Action;
  guard?: GuardKind;
  evidence?: Evidence[];
  latencyMs?: number;
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  edgeIds: string[];
  coverage?: 'observed' | 'inferred';
}

export type FrontierReason =
  | 'unexplored'
  | 'blocked-login'
  | 'blocked-payment'
  | 'blocked-permission'
  | 'budget';

export interface FrontierItem {
  nodeId: string;
  selector?: Selector;
  reason: FrontierReason;
}

export type Platform =
  | 'android-emulator'
  | 'android-device'
  | 'ios-simulator'
  | 'ios-device'
  | 'inferred';

export interface IfgMeta {
  appName: string;
  appId?: string;
  storeUrl?: string;
  platform: Platform;
  appVersion?: string;
  runId?: string;
  coverage?: {
    nodes?: number;
    edges?: number;
    frontier?: number;
    blocked?: number;
    actions?: number;
  };
}

export interface InteractionFlowGraph {
  version: '0.1';
  meta: IfgMeta;
  nodes: ScreenNode[];
  edges: ActionEdge[];
  flows?: Flow[];
  frontier?: FrontierItem[];
}
