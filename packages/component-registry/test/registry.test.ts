import { describe, expect, it } from 'vitest';
import { BUILTINS, byPattern, byRef, forRole } from '../src/index.js';

describe('component registry', () => {
  it('ships 31 built-in blocks with unique, well-formed refs', () => {
    expect(BUILTINS).toHaveLength(31);
    const refs = BUILTINS.map((m) => m.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const ref of refs) expect(ref).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
  });

  it('every block declares at least one pattern and prop names are unique', () => {
    for (const m of BUILTINS) {
      expect(m.patterns.length, m.ref).toBeGreaterThan(0);
      const names = m.props.map((p) => p.name);
      expect(new Set(names).size, m.ref).toBe(names.length);
    }
  });

  it('looks up by ref', () => {
    expect(byRef('oas/cart-item-list')?.name).toBe('Cart Item List');
    expect(byRef('oas/nope')).toBeUndefined();
  });

  it('byPattern ranks role-matching blocks first', () => {
    const forCart = byPattern('list', 'cart');
    expect(forCart[0]!.ref).toBe('oas/cart-item-list');
    expect(byPattern('list').map((m) => m.ref)).toContain('oas/settings-list');
  });

  it('forRole finds role defaults', () => {
    expect(forRole('checkout').map((m) => m.ref)).toContain('oas/checkout-summary');
    expect(forRole('auth').map((m) => m.ref)).toContain('oas/form-group');
  });
});
