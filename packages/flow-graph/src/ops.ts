import type { Action, ActionEdge, Flow, InteractionFlowGraph } from './types.js';

/**
 * Shortest action path (BFS) from `fromId` (default: the first observed node,
 * i.e. the launch screen) to `targetId`. Returns undefined if unreachable.
 */
export function pathTo(
  ifg: InteractionFlowGraph,
  targetId: string,
  fromId: string | undefined = ifg.nodes[0]?.id,
): ActionEdge[] | undefined {
  if (!fromId) return undefined;
  if (fromId === targetId) return [];
  const byFrom = new Map<string, ActionEdge[]>();
  for (const e of ifg.edges) {
    const list = byFrom.get(e.from) ?? [];
    list.push(e);
    byFrom.set(e.from, list);
  }
  const prev = new Map<string, ActionEdge>();
  const queue = [fromId];
  const seen = new Set([fromId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of byFrom.get(cur) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, e);
      if (e.to === targetId) {
        const path: ActionEdge[] = [];
        for (let n = targetId; n !== fromId; n = prev.get(n)!.from) path.unshift(prev.get(n)!);
        return path;
      }
      queue.push(e.to);
    }
  }
  return undefined;
}

/** Extracts the sub-IFG induced by `nodeIds` (edges with both endpoints inside). */
export function subgraph(ifg: InteractionFlowGraph, nodeIds: Iterable<string>): InteractionFlowGraph {
  const keep = new Set(nodeIds);
  const nodes = ifg.nodes.filter((n) => keep.has(n.id));
  const edges = ifg.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const edgeIds = new Set(edges.map((e) => e.id));
  const flows = (ifg.flows ?? []).filter((f) => f.edgeIds.every((id) => edgeIds.has(id)));
  const frontier = (ifg.frontier ?? []).filter((f) => keep.has(f.nodeId));
  return {
    version: ifg.version,
    meta: {
      ...ifg.meta,
      coverage: {
        ...ifg.meta.coverage,
        nodes: nodes.length,
        edges: edges.length,
        frontier: frontier.length,
      },
    },
    nodes,
    edges,
    flows,
    frontier,
  };
}

/**
 * Renders a Flow as a Maestro YAML script — the replay/E2E format.
 * Edges must exist in the graph; unknown edge ids throw.
 */
export function replayScript(ifg: InteractionFlowGraph, flow: Flow): string {
  const edgeById = new Map(ifg.edges.map((e) => [e.id, e]));
  const lines: string[] = [];
  lines.push(`appId: ${ifg.meta.appId ?? ifg.meta.appName}`);
  lines.push(`# flow: ${flow.name}`);
  lines.push('---');
  lines.push('- launchApp');
  for (const edgeId of flow.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) throw new Error(`replayScript: unknown edge id ${edgeId}`);
    lines.push(...commandFor(edge.action));
  }
  return `${lines.join('\n')}\n`;
}

function commandFor(action: Action): string[] {
  switch (action.kind) {
    case 'tap':
    case 'longPress': {
      const props: string[] = [];
      if (action.selector?.resourceId) props.push(`    id: ${quote(action.selector.resourceId)}`);
      else if (action.selector?.text) props.push(`    text: ${quote(action.selector.text)}`);
      else if (action.selector?.accessibilityId) props.push(`    text: ${quote(action.selector.accessibilityId)}`);
      else if (action.point) props.push(`    point: ${quote(`${Math.round(action.point.x)},${Math.round(action.point.y)}`)}`);
      if (action.kind === 'longPress') props.push('    longPress: true');
      return props.length > 0 ? ['- tapOn:', ...props] : ['- tapOn'];
    }
    case 'type':
      return [`- inputText: ${quote(action.inputValue ?? '')}`];
    case 'back':
      return ['- back'];
    case 'swipe': {
      const from = action.point ? `${Math.round(action.point.x)},${Math.round(action.point.y)}` : '50%,70%';
      return ['- swipe:', `    start: ${quote(from)}`, `    direction: ${action.direction ?? 'up'}`];
    }
    case 'scroll':
      return ['- scroll'];
    case 'deepLink':
      return [`- openLink: ${quote(action.deepLinkUrl ?? '')}`];
    case 'launch':
      return ['- launchApp'];
    case 'system':
      return [`# system action (not replayable)`];
  }
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
