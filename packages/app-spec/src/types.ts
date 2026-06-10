import type { ScreenRole } from '@oas/flow-graph';

/** Types mirror schemas/app-spec.schema.json (version 0.1). */

export type ActionProp = { navigate: string } | { back: true } | { submit: true };

export interface ComponentInstance {
  /** Registry ref, e.g. "oas/list". */
  ref: string;
  props?: Record<string, unknown>;
  slots?: Record<string, ComponentInstance[]>;
}

export interface ScreenSpec {
  /** ^[a-z][a-z0-9_]*$ */
  id: string;
  title?: string;
  role?: ScreenRole;
  components: ComponentInstance[];
}

export interface TabSpec {
  id: string;
  screenId: string;
  label: string;
  icon?: string;
}

export type NavigationSpec =
  | { type: 'stack'; initial: string }
  | { type: 'tabs'; tabs: TabSpec[] };

export interface ModelField {
  name: string;
  type: 'string' | 'int' | 'float' | 'boolean' | 'date' | 'url' | 'image';
  required?: boolean;
}

export interface ModelSpec {
  name: string;
  fields: ModelField[];
}

export interface ThemeTokens {
  colors?: Record<string, string>;
  spacing?: Record<string, number>;
  radii?: Record<string, number>;
  typography?: Record<string, unknown>;
}

export interface AppSpec {
  version: '0.1';
  app: {
    name: string;
    appId?: string;
    theme?: ThemeTokens;
  };
  navigation: NavigationSpec;
  screens: ScreenSpec[];
  data?: {
    models?: ModelSpec[];
  };
  meta?: {
    generatedFrom?: 'ifg' | 'canvas' | 'ai';
    sourceRunId?: string;
    sourceStoreUrl?: string;
    /** screen id → originating IFG node id (provenance). */
    sourceNodeIds?: Record<string, string>;
  };
}
