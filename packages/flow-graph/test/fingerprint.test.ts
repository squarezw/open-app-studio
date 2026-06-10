import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/fingerprint.js';
import type { UiNode } from '../src/types.js';

function el(className: string, extra: Partial<UiNode> = {}, children: UiNode[] = []): UiNode {
  return { className, children, ...extra };
}

function feedScreen(itemTexts: string[]): UiNode {
  return el('FrameLayout', {}, [
    el('RecyclerView', { scrollable: true }, itemTexts.map((t) =>
      el('LinearLayout', {}, [
        el('ImageView'),
        el('TextView', { text: t }),
      ]),
    )),
    el('Button', { resourceId: 'btn_refresh', clickable: true, text: 'Refresh' }),
  ]);
}

describe('fingerprint', () => {
  it('ignores text content — same structure, different content → same node', () => {
    const a = feedScreen(['hello', 'world']);
    const b = feedScreen(['完全', '不同的内容']);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('collapses repeated identical siblings — 2 feed items vs 50 → same node', () => {
    const a = feedScreen(['x', 'y']);
    const b = feedScreen(Array.from({ length: 50 }, (_, i) => `item ${i}`));
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('distinguishes structural changes', () => {
    const a = feedScreen(['x']);
    const withExtraButton = el('FrameLayout', {}, [
      ...a.children,
      el('Button', { resourceId: 'btn_new', clickable: true }),
    ]);
    expect(fingerprint(a)).not.toBe(fingerprint(withExtraButton));
  });

  it('distinguishes resource ids', () => {
    const a = el('Button', { resourceId: 'btn_login', clickable: true });
    const b = el('Button', { resourceId: 'btn_signup', clickable: true });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('is stable', () => {
    const a = feedScreen(['x']);
    expect(fingerprint(a)).toBe(fingerprint(a));
    expect(fingerprint(a)).toMatch(/^lh1:[0-9a-f]{40}$/);
  });
});
