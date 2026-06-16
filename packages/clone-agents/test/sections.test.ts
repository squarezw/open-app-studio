import { describe, expect, it } from 'vitest';
import type { InteractionFlowGraph } from '@oas/flow-graph';
import { assignSectionsByStructure } from '../src/heuristic-explorer.js';

/** launch L → Home content (H1→H2); L →(tab)→ Explore root E → E1; plus a pre-main P. */
function graph(): InteractionFlowGraph {
  return {
    version: '0.1',
    meta: { appName: 'x', platform: 'android-emulator' },
    nodes: [
      { id: 'L', fingerprint: 'l', title: 'Home', phase: 'main' },
      { id: 'H1', fingerprint: 'h1', title: 'Banner', phase: 'main' },
      { id: 'H2', fingerprint: 'h2', title: 'Product', phase: 'main' },
      { id: 'E', fingerprint: 'e', title: 'Explore', phase: 'main' },
      { id: 'E1', fingerprint: 'e1', title: 'Category list', phase: 'main' },
      { id: 'P', fingerprint: 'p', title: 'Login', phase: 'pre-main' },
    ],
    edges: [
      { id: 'a', from: 'L', to: 'H1', action: { kind: 'tap', selector: { resourceId: 'x:id/banner' } } },
      { id: 'b', from: 'H1', to: 'H2', action: { kind: 'tap', selector: { resourceId: 'x:id/card' } } },
      { id: 'c', from: 'L', to: 'E', action: { kind: 'tap', selector: { resourceId: 'x:id/explore_dest' } } },
      { id: 'd', from: 'E', to: 'E1', action: { kind: 'tap', selector: { resourceId: 'x:id/cat' } } },
      { id: 'e', from: 'H2', to: 'L', action: { kind: 'back' } },
    ],
    frontier: [],
  } as unknown as InteractionFlowGraph;
}

describe('assignSectionsByStructure', () => {
  it('claims each tab root subtree; stops at tab edges and other roots', () => {
    const g = graph();
    assignSectionsByStructure(g, new Map([['Home', 'L'], ['Explore', 'E']]));
    const sec = (id: string) => g.nodes.find((n) => n.id === id)!.section;
    // Home root's reachable content — but NOT across the explore_dest tab edge
    expect(sec('L')).toBe('Home');
    expect(sec('H1')).toBe('Home');
    expect(sec('H2')).toBe('Home');
    // Explore subtree comes from the Explore root, not from L's BFS
    expect(sec('E')).toBe('Explore');
    expect(sec('E1')).toBe('Explore');
    // pre-main is left alone (the UI maps it to the 'Pre-main' menu via phase)
    expect(sec('P')).toBeUndefined();
  });
});
