import type { PatternKind, ScreenRole } from '@oas/flow-graph';

/** Prop contract for a block — drives the canvas props inspector and codegen typing. */
export interface PropSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'binding' | 'action' | 'items';
  description?: string;
  required?: boolean;
  default?: unknown;
  /** For type 'enum'. */
  values?: string[];
}

/**
 * A registry block. M2 ships manifests (what the Blueprint Compiler and the
 * canvas need); the React Native implementations land alongside codegen.
 */
export interface ComponentManifest {
  /** Registry ref, e.g. "oas/cart-item-list". */
  ref: string;
  name: string;
  description: string;
  /** IFG ComponentPattern kinds this block can realize — the Blueprint Compiler's lookup key. */
  patterns: PatternKind[];
  /** Screen roles this block typically belongs to (used for role-based defaults). */
  roles?: ScreenRole[];
  props: PropSpec[];
  /** Named children regions, e.g. a card's header/body/footer. */
  slots?: string[];
}
