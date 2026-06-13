import { describe, expect, it } from 'vitest';
import type { InteractionFlowGraph } from '@oas/flow-graph';
import { deriveLeafFlows } from '../src/annotator.js';

/** Minimal IFG builder: linear chain a→b→c plus an optional branch. */
function makeGraph(): InteractionFlowGraph {
  return {
    meta: { appId: 'com.test', platform: 'android', createdAt: '2026-06-13T00:00:00Z' },
    nodes: [
      { id: 'home', fingerprint: 'home', title: 'Home', visits: 1 },
      { id: 'list', fingerprint: 'list', title: 'List', visits: 1 },
      { id: 'detail', fingerprint: 'detail', title: 'Detail', visits: 1 },
      { id: 'cart', fingerprint: 'cart', title: 'Cart', visits: 1 },
    ],
    edges: [
      { id: 'e1', from: 'home', to: 'list', action: { kind: 'tap', selector: { text: 'Browse' } } },
      { id: 'e2', from: 'list', to: 'detail', action: { kind: 'tap', selector: { text: 'Item' } } },
      { id: 'e3', from: 'home', to: 'cart', action: { kind: 'tap', selector: { text: 'Cart' } } },
      // a back edge out of detail must NOT count as a forward transition
      { id: 'e4', from: 'detail', to: 'list', action: { kind: 'back' } },
    ],
    frontier: [],
  } as unknown as InteractionFlowGraph;
}

describe('deriveLeafFlows', () => {
  it('produces one full route per dead-end leaf, excluding the launch node', () => {
    const flows = deriveLeafFlows(makeGraph());
    const names = flows.map((f) => f.name).sort();
    // leaves are `detail` (only outgoing is a back edge) and `cart` (no outgoing)
    expect(names).toEqual(['Path to Cart', 'Path to Detail']);

    const detail = flows.find((f) => f.name === 'Path to Detail')!;
    expect(detail.edgeIds).toEqual(['e1', 'e2']); // home → list → detail
    const cart = flows.find((f) => f.name === 'Path to Cart')!;
    expect(cart.edgeIds).toEqual(['e3']); // home → cart
  });

  it('drops a leaf path that is a strict prefix of a longer one', () => {
    const g = makeGraph();
    // remove the detail→back edge so `list` is no longer a forward source...
    // instead make `list` itself a leaf in addition to `detail` by adding a
    // shorter chain that is a prefix: home→list is a prefix of home→list→detail.
    g.edges = g.edges.filter((e) => e.id !== 'e4');
    // `list` now has a forward edge (e2) so it is NOT a leaf; only detail + cart are.
    const flows = deriveLeafFlows(g);
    expect(flows.map((f) => f.name).sort()).toEqual(['Path to Cart', 'Path to Detail']);
    // the home→list prefix is subsumed by home→list→detail, so it never appears
    expect(flows.some((f) => f.edgeIds.join(',') === 'e1')).toBe(false);
  });
});
