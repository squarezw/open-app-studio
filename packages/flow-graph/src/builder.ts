import { fingerprint } from './fingerprint.js';
import type {
  Action,
  ActionEdge,
  Evidence,
  Flow,
  FrontierItem,
  GuardKind,
  IfgMeta,
  InteractionFlowGraph,
  ScreenNode,
  Selector,
  UiNode,
} from './types.js';

export interface Observation {
  tree: UiNode;
  routeHint?: string;
  screenshotRef?: string;
  capturedAt?: string;
  /** Best-effort human label captured at observation time (e.g. top text element). */
  titleHint?: string;
}

/** Emitted as the graph grows — the live-streaming contract for Studio/gateway. */
export type GraphEvent =
  | { type: 'node'; node: ScreenNode; isNew: boolean }
  | { type: 'edge'; edge: ActionEdge; isNew: boolean };

export interface RecordActionOptions {
  guard?: GuardKind;
  evidence?: Evidence[];
  latencyMs?: number;
}

export function selectorKey(selector: Selector): string {
  return JSON.stringify([
    selector.accessibilityId ?? null,
    selector.resourceId ?? null,
    selector.text ?? null,
    selector.xpath ?? null,
    selector.index ?? null,
  ]);
}

/**
 * Folds a stream of observations and actions (an exploration trace) into a
 * canonical IFG: nodes deduped by structural fingerprint, edges canonicalized
 * by (from, to, action shape), frontier = interactables noted but never tried.
 */
export class GraphBuilder {
  private nodesByFingerprint = new Map<string, ScreenNode>();
  private edgesByKey = new Map<string, ActionEdge>();
  private flows: Flow[] = [];
  /** nodeId → selectorKey → { selector, tried } */
  private interactables = new Map<string, Map<string, { selector: Selector; tried: boolean }>>();
  private actionCount = 0;
  private nodeSeq = 0;
  private edgeSeq = 0;

  constructor(
    private meta: Omit<IfgMeta, 'coverage'>,
    private onEvent?: (event: GraphEvent) => void,
  ) {}

  get counts(): { nodes: number; edges: number; actions: number } {
    return {
      nodes: this.nodesByFingerprint.size,
      edges: this.edgesByKey.size,
      actions: this.actionCount,
    };
  }

  /** Registers a screen state; returns its (possibly pre-existing) node id. */
  observe(obs: Observation): string {
    const fp = fingerprint(obs.tree);
    let node = this.nodesByFingerprint.get(fp);
    const isNew = !node;
    if (!node) {
      node = { id: `n_${++this.nodeSeq}`, fingerprint: fp, visits: 0, evidence: [] };
      this.nodesByFingerprint.set(fp, node);
    }
    node.visits = (node.visits ?? 0) + 1;
    if (obs.routeHint && !node.routeHint) node.routeHint = obs.routeHint;
    if (obs.titleHint && !node.title) node.title = obs.titleHint;
    if (obs.screenshotRef && (node.evidence?.length ?? 0) < 3) {
      node.evidence!.push({
        type: 'screenshot',
        ref: obs.screenshotRef,
        ...(obs.capturedAt ? { capturedAt: obs.capturedAt } : {}),
      });
    }
    this.onEvent?.({ type: 'node', node, isNew });
    return node.id;
  }

  recordAction(fromId: string, action: Action, toId: string, opts: RecordActionOptions = {}): string {
    this.actionCount += 1;
    const key = JSON.stringify([
      fromId,
      toId,
      action.kind,
      action.selector ? selectorKey(action.selector) : null,
      action.direction ?? null,
    ]);
    let edge = this.edgesByKey.get(key);
    const isNew = !edge;
    if (!edge) {
      edge = {
        id: `e_${++this.edgeSeq}`,
        from: fromId,
        to: toId,
        action,
        guard: opts.guard ?? 'none',
        evidence: [],
      };
      this.edgesByKey.set(key, edge);
    }
    if (opts.evidence && (edge.evidence?.length ?? 0) < 3) edge.evidence!.push(...opts.evidence);
    if (opts.latencyMs !== undefined) edge.latencyMs = opts.latencyMs;
    this.onEvent?.({ type: 'edge', edge, isNew });
    return edge.id;
  }

  /** Marks an interactable element as seen on a node (frontier candidate). */
  noteInteractable(nodeId: string, selector: Selector): void {
    let forNode = this.interactables.get(nodeId);
    if (!forNode) {
      forNode = new Map();
      this.interactables.set(nodeId, forNode);
    }
    const key = selectorKey(selector);
    if (!forNode.has(key)) forNode.set(key, { selector, tried: false });
  }

  markTried(nodeId: string, selector: Selector): void {
    this.noteInteractable(nodeId, selector);
    this.interactables.get(nodeId)!.get(selectorKey(selector))!.tried = true;
  }

  hasUntried(nodeId: string): boolean {
    return this.untried(nodeId).length > 0;
  }

  untried(nodeId: string): Selector[] {
    const forNode = this.interactables.get(nodeId);
    if (!forNode) return [];
    return [...forNode.values()].filter((i) => !i.tried).map((i) => i.selector);
  }

  addFlow(flow: Flow): void {
    this.flows.push(flow);
  }

  toIFG(): InteractionFlowGraph {
    const frontier: FrontierItem[] = [];
    for (const [nodeId, forNode] of this.interactables) {
      for (const { selector, tried } of forNode.values()) {
        if (!tried) frontier.push({ nodeId, selector, reason: 'unexplored' });
      }
    }
    const nodes = [...this.nodesByFingerprint.values()];
    const edges = [...this.edgesByKey.values()];
    return {
      version: '0.1',
      meta: {
        ...this.meta,
        coverage: {
          nodes: nodes.length,
          edges: edges.length,
          frontier: frontier.length,
          blocked: 0,
          actions: this.actionCount,
        },
      },
      nodes,
      edges,
      flows: this.flows,
      frontier,
    };
  }

  summary(): { nodes: number; edges: number; frontier: number; actions: number } {
    const ifg = this.toIFG();
    return {
      nodes: ifg.nodes.length,
      edges: ifg.edges.length,
      frontier: ifg.frontier?.length ?? 0,
      actions: this.actionCount,
    };
  }
}
