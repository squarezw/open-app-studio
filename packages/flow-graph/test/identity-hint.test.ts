import { describe, expect, it } from 'vitest';
import { GraphBuilder } from '../src/builder.js';
import type { UiNode } from '../src/types.js';

// Two structurally-identical screens (same className tree) — iHerb's Home and
// Explore look alike, so they share a structural fingerprint.
const lookalike = (): UiNode => ({
  className: 'FrameLayout',
  bounds: { x: 0, y: 0, w: 1080, h: 1920 },
  children: [
    { className: 'EditText', bounds: { x: 0, y: 0, w: 1080, h: 120 }, clickable: true, children: [] },
    { className: 'RecyclerView', bounds: { x: 0, y: 120, w: 1080, h: 1800 }, scrollable: true, children: [] },
  ],
});

describe('GraphBuilder identity hints', () => {
  it('collapses look-alike screens by default (pure structural dedup)', () => {
    const g = new GraphBuilder({ appName: 'x', platform: 'android-emulator' });
    const a = g.observe({ tree: lookalike() });
    const b = g.observe({ tree: lookalike() });
    expect(a).toBe(b);
    expect(g.toIFG().nodes).toHaveLength(1);
  });

  it('keeps look-alike screens distinct under different identity hints', () => {
    const g = new GraphBuilder({ appName: 'x', platform: 'android-emulator' });
    const home = g.observe({ tree: lookalike(), identityHint: 'Home' });
    const explore = g.observe({ tree: lookalike(), identityHint: 'Explore' });
    const homeAgain = g.observe({ tree: lookalike(), identityHint: 'Home' });
    expect(home).not.toBe(explore); // Home ≠ Explore even though structure is identical
    expect(home).toBe(homeAgain); // same hint → same node (stable across re-observes)
    expect(g.toIFG().nodes).toHaveLength(2);
  });
});
