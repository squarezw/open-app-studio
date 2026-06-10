import type { ActionEdge, InteractionFlowGraph, ScreenNode } from '@oas/flow-graph';

/**
 * Converts an IFG (or the partial graph accumulated from live events) into
 * React Flow nodes/edges with a deterministic layered layout: BFS depth from
 * the launch screen → column, order of discovery within a layer → row.
 */

export type PartialIfg = Pick<InteractionFlowGraph, 'nodes' | 'edges'> &
  Partial<Pick<InteractionFlowGraph, 'flows' | 'meta' | 'frontier'>>;

export interface FlowNode {
  id: string;
  type: 'screen';
  position: { x: number; y: number };
  data: {
    title: string;
    role?: string;
    visits: number;
    screenshotUrl?: string;
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

const COL_W = 300;
const ROW_H = 150;

export function ifgToFlow(ifg: PartialIfg): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const depth = layerByBfs(ifg);
  const rows = new Map<number, number>();

  const nodes = ifg.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
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
        screenshotUrl: firstHttpScreenshot(n),
      },
    };
  });

  const edges = ifg.edges.map((e) => {
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
  return n.evidence?.find((e) => e.type === 'screenshot' && /^https?:\/\//.test(e.ref))?.ref;
}
