import { describe, expect, it } from 'vitest';
import { edgeLabel, ifgToFlow } from '../lib/ifg-to-flow.js';
import type { PartialIfg } from '../lib/ifg-to-flow.js';

const IFG: PartialIfg = {
  nodes: [
    { id: 'home', fingerprint: 'lh1:a', title: 'Home', role: 'launch', visits: 4 },
    { id: 'cart', fingerprint: 'lh1:b', title: 'Cart', role: 'cart', visits: 2,
      evidence: [{ type: 'screenshot', ref: 'https://example.com/cart.png' }] },
    { id: 'checkout', fingerprint: 'lh1:c', title: 'Checkout', role: 'checkout', visits: 1,
      evidence: [{ type: 'screenshot', ref: '/local/path.png' }] },
    { id: 'orphan', fingerprint: 'lh1:d' },
  ],
  edges: [
    { id: 'e1', from: 'home', to: 'cart', action: { kind: 'tap', selector: { resourceId: 'com.x:id/btn_cart' } } },
    { id: 'e2', from: 'cart', to: 'checkout', action: { kind: 'tap', selector: { text: 'Checkout' } } },
    { id: 'e3', from: 'cart', to: 'home', action: { kind: 'back' } },
  ],
};

describe('ifgToFlow', () => {
  it('lays out nodes in BFS layers (back edges ignored for depth)', () => {
    const { nodes } = ifgToFlow(IFG);
    const x = new Map(nodes.map((n) => [n.id, n.position.x]));
    // default COL_W (screenshots shown) = 320
    expect(x.get('home')).toBe(0);
    expect(x.get('cart')).toBe(320);
    expect(x.get('checkout')).toBe(640);
    expect(x.get('orphan')).toBe(960); // unreachable → one past deepest layer
  });

  it('marks back edges and keeps forward edges animated', () => {
    const { edges } = ifgToFlow(IFG);
    const byId = new Map(edges.map((e) => [e.id, e]));
    expect(byId.get('e1')).toMatchObject({ animated: true, isBack: false });
    expect(byId.get('e3')).toMatchObject({ animated: false, isBack: true, label: 'back' });
  });

  it('only exposes http(s) screenshots', () => {
    const { nodes } = ifgToFlow(IFG);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('cart')!.data.screenshotUrl).toBe('https://example.com/cart.png');
    expect(byId.get('checkout')!.data.screenshotUrl).toBeUndefined();
  });

  it('renders compact edge labels', () => {
    expect(edgeLabel({ id: 'x', from: 'a', to: 'b', action: { kind: 'tap', selector: { resourceId: 'com.x:id/btn_cart' } } }))
      .toBe('tap btn_cart');
    expect(edgeLabel({ id: 'x', from: 'a', to: 'b', action: { kind: 'tap', selector: { text: 'Buy' } } }))
      .toBe('tap Buy');
    expect(edgeLabel({ id: 'x', from: 'a', to: 'b', action: { kind: 'type', inputValue: 'hi' } }))
      .toBe('type "hi"');
  });

  it('handles an empty graph', () => {
    expect(ifgToFlow({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });
});
