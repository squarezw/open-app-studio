import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import type { InteractionFlowGraph } from '@oas/flow-graph';
import { compileBlueprint } from '../src/blueprint-compiler.js';

/** Annotated IFG mirroring the fake demo shop, plus an auth screen with observed form fields. */
const SHOP_IFG: InteractionFlowGraph = {
  version: '0.1',
  meta: { appName: 'FakeShop', appId: 'com.fakeshop', platform: 'android-emulator', storeUrl: 'https://play.google.com/store/apps/details?id=com.fakeshop' },
  nodes: [
    { id: 'n_home', fingerprint: 'lh1:a', title: 'FakeShop Home', role: 'launch', visits: 5 },
    { id: 'n_search', fingerprint: 'lh1:b', title: 'Search products', role: 'search', visits: 1 },
    { id: 'n_profile', fingerprint: 'lh1:c', title: 'My Profile', role: 'profile', visits: 2 },
    { id: 'n_cart', fingerprint: 'lh1:d', title: 'Shopping Cart', role: 'cart', visits: 2,
      patterns: [{ kind: 'list', region: { x: 0, y: 200, w: 1080, h: 1600 } }] },
    { id: 'n_checkout', fingerprint: 'lh1:e', title: 'Checkout — payment', role: 'checkout', visits: 1 },
    { id: 'n_login', fingerprint: 'lh1:f', title: 'Login', role: 'auth', visits: 1,
      patterns: [{ kind: 'form', fields: [
        { label: 'Phone number', keyboard: 'phone', required: true },
        { label: 'Password', keyboard: 'password', required: true },
      ] }] },
  ],
  edges: [
    { id: 'e1', from: 'n_home', to: 'n_search', action: { kind: 'tap', selector: { resourceId: 'com.fakeshop:id/btn_search' } } },
    { id: 'e2', from: 'n_home', to: 'n_profile', action: { kind: 'tap', selector: { text: 'My Profile' } } },
    { id: 'e3', from: 'n_home', to: 'n_cart', action: { kind: 'tap', selector: { resourceId: 'com.fakeshop:id/btn_cart' } } },
    { id: 'e4', from: 'n_cart', to: 'n_checkout', action: { kind: 'tap', selector: { resourceId: 'com.fakeshop:id/btn_checkout' } } },
    { id: 'e5', from: 'n_profile', to: 'n_login', action: { kind: 'tap', selector: { text: 'Sign in' } } },
    { id: 'e6', from: 'n_cart', to: 'n_home', action: { kind: 'back' } },
  ],
  flows: [],
  frontier: [],
};

describe('compileBlueprint', () => {
  const spec = compileBlueprint(SHOP_IFG, { runId: 'run-1' });

  it('produces one screen per node with schema-valid ids', () => {
    expect(spec.screens).toHaveLength(6);
    for (const s of spec.screens) expect(s.id).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(new Set(spec.screens.map((s) => s.id)).size).toBe(6);
  });

  it('detects the home fan-out as tab navigation', () => {
    expect(spec.navigation.type).toBe('tabs');
    if (spec.navigation.type !== 'tabs') return;
    const labels = spec.navigation.tabs.map((t) => t.label);
    expect(labels).toContain('FakeShop Home');
    expect(labels).toContain('Search');       // humanized from btn_search
    expect(labels).toContain('My Profile');
  });

  it('picks role-default blocks (cart → cart-item-list, checkout → checkout-summary)', () => {
    const byId = new Map(spec.screens.map((s) => [s.id, s]));
    const cart = byId.get('shopping_cart')!;
    expect(cart.components.map((c) => c.ref)).toContain('oas/cart-item-list');
    expect(cart.components.map((c) => c.ref)).toContain('oas/price-row');
    const checkout = byId.get('checkout_payment')!;
    expect(checkout.components[0]!.ref).toBe('oas/checkout-summary');
  });

  it('wires forward edges as navigation buttons (excluding tab edges)', () => {
    const byId = new Map(spec.screens.map((s) => [s.id, s]));
    const cartButtons = byId.get('shopping_cart')!.components.filter((c) => c.ref === 'oas/button-primary');
    expect(cartButtons).toHaveLength(1);
    expect(cartButtons[0]!.props).toMatchObject({ label: 'Checkout', onPress: { navigate: 'checkout_payment' } });
    // home's fan-out became tabs, not buttons
    const home = byId.get('fakeshop_home')!;
    expect(home.components.filter((c) => c.ref === 'oas/button-primary')).toHaveLength(0);
  });

  it('collects observed form fields into a data model', () => {
    const login = spec.screens.find((s) => s.role === 'auth')!;
    const form = login.components.find((c) => c.ref === 'oas/form-group')!;
    expect(form.props!.fields).toMatchObject([
      { name: 'phone_number', keyboard: 'phone', required: true },
      { name: 'password', keyboard: 'password', required: true },
    ]);
    expect(spec.data?.models?.[0]).toMatchObject({ name: 'Login', fields: [{ name: 'phone_number', type: 'string' }, { name: 'password', type: 'string' }] });
  });

  it('records provenance', () => {
    expect(spec.meta).toMatchObject({ generatedFrom: 'ifg', sourceRunId: 'run-1' });
    expect(spec.meta!.sourceNodeIds!['shopping_cart']).toBe('n_cart');
    expect(spec.app.appId).toBe('dev.openappstudio.fakeshop');
  });

  it('compiles a subgraph with stack navigation', () => {
    const sub = compileBlueprint(SHOP_IFG, { nodeIds: ['n_cart', 'n_checkout'] });
    expect(sub.screens).toHaveLength(2);
    expect(sub.navigation).toEqual({ type: 'stack', initial: 'shopping_cart' });
  });

  it('validates against the published App Spec schema', () => {
    const schema = JSON.parse(readFileSync(new URL('../../../schemas/app-spec.schema.json', import.meta.url), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(spec), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(validate(compileBlueprint(SHOP_IFG, { nodeIds: ['n_cart', 'n_checkout'] }))).toBe(true);
  });

  it('rejects an empty graph', () => {
    expect(() => compileBlueprint({ ...SHOP_IFG, nodes: [], edges: [] })).toThrow(/no nodes/);
  });
});
