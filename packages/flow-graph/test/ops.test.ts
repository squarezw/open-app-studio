import { describe, expect, it } from 'vitest';
import { pathTo, replayScript, subgraph } from '../src/ops.js';
import type { InteractionFlowGraph } from '../src/types.js';

/** home → list → detail; home → profile; detail/profile have back edges. */
const IFG: InteractionFlowGraph = {
  version: '0.1',
  meta: { appName: 'Demo', appId: 'com.demo', platform: 'android-emulator' },
  nodes: [
    { id: 'home', fingerprint: 'lh1:a' },
    { id: 'list', fingerprint: 'lh1:b' },
    { id: 'detail', fingerprint: 'lh1:c' },
    { id: 'profile', fingerprint: 'lh1:d' },
  ],
  edges: [
    { id: 'e1', from: 'home', to: 'list', action: { kind: 'tap', selector: { resourceId: 'com.demo:id/btn_list' } } },
    { id: 'e2', from: 'list', to: 'detail', action: { kind: 'tap', selector: { text: 'Apple' } } },
    { id: 'e3', from: 'home', to: 'profile', action: { kind: 'tap', selector: { accessibilityId: 'my profile' } } },
    { id: 'e4', from: 'detail', to: 'list', action: { kind: 'back' } },
    { id: 'e5', from: 'list', to: 'home', action: { kind: 'back' } },
  ],
  flows: [{ id: 'f1', name: 'View item', edgeIds: ['e1', 'e2'], coverage: 'observed' }],
  frontier: [{ nodeId: 'profile', selector: { resourceId: 'com.demo:id/btn_edit' }, reason: 'unexplored' }],
};

describe('pathTo', () => {
  it('finds the shortest path from the launch node', () => {
    expect(pathTo(IFG, 'detail')?.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(pathTo(IFG, 'profile')?.map((e) => e.id)).toEqual(['e3']);
  });

  it('returns [] for the launch node itself and undefined when unreachable', () => {
    expect(pathTo(IFG, 'home')).toEqual([]);
    const noEdges = { ...IFG, edges: [] };
    expect(pathTo(noEdges, 'detail')).toBeUndefined();
  });
});

describe('subgraph', () => {
  it('keeps only induced nodes, edges, flows and frontier', () => {
    const sub = subgraph(IFG, ['home', 'list', 'detail']);
    expect(sub.nodes.map((n) => n.id)).toEqual(['home', 'list', 'detail']);
    expect(sub.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e4', 'e5']);
    expect(sub.flows).toHaveLength(1);
    expect(sub.frontier).toHaveLength(0);
    expect(sub.meta.coverage?.nodes).toBe(3);
  });

  it('drops flows that cross the boundary', () => {
    const sub = subgraph(IFG, ['home', 'profile']);
    expect(sub.flows).toHaveLength(0);
    expect(sub.frontier).toHaveLength(1);
  });
});

describe('replayScript', () => {
  it('renders a flow as Maestro YAML', () => {
    const yaml = replayScript(IFG, IFG.flows![0]!);
    expect(yaml).toBe(
      [
        'appId: com.demo',
        '# flow: View item',
        '---',
        '- launchApp',
        '- tapOn:',
        '    id: "com.demo:id/btn_list"',
        '- tapOn:',
        '    text: "Apple"',
        '',
      ].join('\n'),
    );
  });

  it('maps back/type/deepLink actions', () => {
    const yaml = replayScript(IFG, {
      id: 'f2',
      name: 'Misc',
      edgeIds: ['e4'],
    });
    expect(yaml).toContain('- back');
  });

  it('throws on unknown edge ids', () => {
    expect(() => replayScript(IFG, { id: 'f3', name: 'Bad', edgeIds: ['nope'] })).toThrow(/unknown edge/);
  });
});
