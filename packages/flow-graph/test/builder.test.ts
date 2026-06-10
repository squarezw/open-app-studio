import { describe, expect, it } from 'vitest';
import { GraphBuilder } from '../src/builder.js';
import type { UiNode } from '../src/types.js';

function screen(resourceId: string, text?: string): UiNode {
  return {
    className: 'FrameLayout',
    children: [
      { className: 'Button', resourceId, clickable: true, text, children: [] },
    ],
  };
}

function makeBuilder() {
  return new GraphBuilder({ appName: 'Test', platform: 'android-emulator' });
}

describe('GraphBuilder', () => {
  it('dedups observations of the same screen by fingerprint', () => {
    const b = makeBuilder();
    const id1 = b.observe({ tree: screen('btn_a', 'first visit') });
    const id2 = b.observe({ tree: screen('btn_a', 'second visit, new content') });
    expect(id1).toBe(id2);
    const ifg = b.toIFG();
    expect(ifg.nodes).toHaveLength(1);
    expect(ifg.nodes[0]!.visits).toBe(2);
  });

  it('creates distinct nodes for distinct screens', () => {
    const b = makeBuilder();
    const home = b.observe({ tree: screen('btn_home') });
    const detail = b.observe({ tree: screen('btn_detail') });
    expect(home).not.toBe(detail);
    expect(b.toIFG().nodes).toHaveLength(2);
  });

  it('canonicalizes repeated identical actions into one edge', () => {
    const b = makeBuilder();
    const home = b.observe({ tree: screen('btn_home') });
    const detail = b.observe({ tree: screen('btn_detail') });
    const action = { kind: 'tap' as const, selector: { resourceId: 'btn_home' } };
    const e1 = b.recordAction(home, action, detail);
    const e2 = b.recordAction(home, action, detail);
    expect(e1).toBe(e2);
    const ifg = b.toIFG();
    expect(ifg.edges).toHaveLength(1);
    expect(ifg.meta.coverage?.actions).toBe(2);
  });

  it('tracks frontier as noted-but-untried interactables', () => {
    const b = makeBuilder();
    const home = b.observe({ tree: screen('btn_home') });
    b.noteInteractable(home, { resourceId: 'btn_a' });
    b.noteInteractable(home, { resourceId: 'btn_b' });
    b.markTried(home, { resourceId: 'btn_a' });
    expect(b.hasUntried(home)).toBe(true);
    expect(b.untried(home)).toEqual([{ resourceId: 'btn_b' }]);
    const ifg = b.toIFG();
    expect(ifg.frontier).toEqual([
      { nodeId: home, selector: { resourceId: 'btn_b' }, reason: 'unexplored' },
    ]);
    expect(ifg.meta.coverage?.frontier).toBe(1);
  });

  it('keeps screenshot evidence per node, capped', () => {
    const b = makeBuilder();
    for (let i = 0; i < 5; i++) {
      b.observe({ tree: screen('btn_a'), screenshotRef: `blob://run/step_${i}.png` });
    }
    const node = b.toIFG().nodes[0]!;
    expect(node.evidence!.length).toBe(3);
    expect(node.evidence![0]!.type).toBe('screenshot');
  });
});
