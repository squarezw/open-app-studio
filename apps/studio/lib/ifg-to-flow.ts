import type { ActionEdge, InteractionFlowGraph, ScreenNode } from '@oas/flow-graph';

/**
 * Converts an IFG (or the partial graph accumulated from live events) into
 * React Flow nodes/edges with a deterministic layered layout: BFS depth from
 * the launch screen → column, order of discovery within a layer → row.
 */

export type PartialIfg = Pick<InteractionFlowGraph, 'nodes' | 'edges'> &
  Partial<Pick<InteractionFlowGraph, 'flows' | 'meta' | 'frontier'>>;

/** A point that was tapped on this screen (device coords) + where it led. */
export interface TapMarker {
  x: number;
  y: number;
  label: string;
  edgeId: string;
}

export interface FlowNode {
  id: string;
  type: 'screen';
  position: { x: number; y: number };
  data: {
    title: string;
    role?: string;
    visits: number;
    screenshotUrl?: string;
    phase?: 'pre-main' | 'main';
    section?: string;
    hasTabbar?: boolean;
    /** Tap points originating from this screen, for the click-region overlay. */
    taps?: TapMarker[];
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  animated: boolean;
  isBack: boolean;
}

/** Section a node belongs to for grouping: 'Pre-main' for pre-main screens, else its tab section. */
export function nodeSection(n: { phase?: 'pre-main' | 'main'; section?: string }): string | undefined {
  return n.phase === 'pre-main' ? 'Pre-main' : n.section;
}

export function ifgToFlow(
  ifg: PartialIfg,
  opts: { showImages?: boolean; sectionFilter?: string } = {},
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const showImages = opts.showImages ?? true;
  // Restrict to one section's subgraph (its nodes + edges between them) when asked.
  const keep = opts.sectionFilter
    ? new Set(ifg.nodes.filter((n) => nodeSection(n) === opts.sectionFilter).map((n) => n.id))
    : null;
  const visNodes = keep ? ifg.nodes.filter((n) => keep.has(n.id)) : ifg.nodes;
  const visEdges = keep ? ifg.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) : ifg.edges;
  // With screenshots the cards are tall (phone aspect) — space rows out so they
  // don't overlap. Without screenshots they're compact, so pack them tighter.
  const COL_W = showImages ? 320 : 240;
  const ROW_H = showImages ? 380 : 96;

  const depth = layerByBfs(ifg);
  const rows = new Map<number, number>();

  // Tap points per screen (device coords) — "what region was tapped, and where
  // it led". Back/scroll have no meaningful point.
  const titleById = new Map(ifg.nodes.map((n) => [n.id, n.title ?? n.id]));
  const tapsByNode = new Map<string, TapMarker[]>();
  for (const e of visEdges) {
    const p = e.action.point;
    if (!p || e.action.kind === 'back' || e.action.kind === 'scroll') continue;
    const arr = tapsByNode.get(e.from) ?? [];
    arr.push({ x: p.x, y: p.y, label: `${edgeLabel(e)} → ${titleById.get(e.to) ?? e.to}`, edgeId: e.id });
    tapsByNode.set(e.from, arr);
  }

  // Within each column, put tab-bar screens (the section roots: Home, Explore,
  // Cart, …) first, so the column right of Launch reads as the tab bar top-to-
  // bottom; ordinary content follows. Stable otherwise (discovery order).
  const isTab = (n: ScreenNode) => n.patterns?.some((p) => p.kind === 'tabbar') ?? false;
  const ordered = visNodes
    .map((n, i) => ({ n, i, d: depth.get(n.id) ?? 0 }))
    .sort((a, b) => a.d - b.d || (isTab(b.n) ? 1 : 0) - (isTab(a.n) ? 1 : 0) || a.i - b.i);

  const nodes = ordered.map(({ n, d }) => {
    const row = rows.get(d) ?? 0;
    rows.set(d, row + 1);
    return {
      id: n.id,
      type: 'screen' as const,
      position: { x: d * COL_W, y: row * ROW_H },
      data: {
        title: n.title ?? n.id,
        role: n.role,
        visits: n.visits ?? 0,
        screenshotUrl: showImages ? firstHttpScreenshot(n) : undefined,
        phase: n.phase,
        section: n.section,
        hasTabbar: n.patterns?.some((p) => p.kind === 'tabbar'),
        taps: tapsByNode.get(n.id),
      },
    };
  });

  const edges = visEdges.map((e) => {
    const isBack = e.action.kind === 'back';
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      label: edgeLabel(e),
      animated: !isBack,
      isBack,
    };
  });

  return { nodes, edges };
}

/** BFS depth from the launch node, following forward (non-back) edges first. */
function layerByBfs(ifg: PartialIfg): Map<string, number> {
  const depth = new Map<string, number>();
  const start = ifg.nodes[0]?.id;
  if (!start) return depth;

  const forward = new Map<string, string[]>();
  for (const e of ifg.edges) {
    if (e.action.kind === 'back') continue;
    forward.set(e.from, [...(forward.get(e.from) ?? []), e.to]);
  }

  depth.set(start, 0);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of forward.get(cur) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(cur)! + 1);
      queue.push(next);
    }
  }
  // Nodes unreachable via forward edges (or discovered before their edge) go one past the deepest layer.
  const maxDepth = Math.max(0, ...depth.values());
  for (const n of ifg.nodes) {
    if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);
  }
  return depth;
}

export function edgeLabel(e: ActionEdge): string {
  const a = e.action;
  switch (a.kind) {
    case 'tap':
    case 'longPress': {
      const target =
        a.selector?.text ??
        a.selector?.resourceId?.split('/').pop() ??
        a.selector?.accessibilityId ??
        '·';
      return `${a.kind} ${target}`;
    }
    case 'type':
      return `type "${a.inputValue ?? ''}"`;
    case 'swipe':
      return `swipe ${a.direction ?? ''}`.trim();
    default:
      return a.kind;
  }
}

function firstHttpScreenshot(n: ScreenNode): string | undefined {
  // http(s) = store metadata; /api/... = a gateway-served captured screenshot.
  return n.evidence?.find(
    (e) => e.type === 'screenshot' && (/^https?:\/\//.test(e.ref) || e.ref.startsWith('/api/')),
  )?.ref;
}
