import { describe, expect, it } from 'vitest';
import { compileBlueprint } from '@oas/app-spec';
import type { InteractionFlowGraph } from '@oas/flow-graph';
import { generateProject } from '../src/generate.js';
import { componentName, propExpr, propsToJsx } from '../src/props.js';

const SHOP_IFG: InteractionFlowGraph = {
  version: '0.1',
  meta: { appName: 'FakeShop', appId: 'com.fakeshop', platform: 'android-emulator' },
  nodes: [
    { id: 'n_home', fingerprint: 'lh1:a', title: 'FakeShop Home', role: 'launch' },
    { id: 'n_search', fingerprint: 'lh1:b', title: 'Search products', role: 'search' },
    { id: 'n_cart', fingerprint: 'lh1:c', title: 'Shopping Cart', role: 'cart' },
    { id: 'n_checkout', fingerprint: 'lh1:d', title: 'Checkout — payment', role: 'checkout' },
  ],
  edges: [
    { id: 'e1', from: 'n_home', to: 'n_search', action: { kind: 'tap', selector: { resourceId: 'com.fakeshop:id/btn_search' } } },
    { id: 'e2', from: 'n_home', to: 'n_cart', action: { kind: 'tap', selector: { resourceId: 'com.fakeshop:id/btn_cart' } } },
    { id: 'e3', from: 'n_cart', to: 'n_checkout', action: { kind: 'tap', selector: { resourceId: 'com.fakeshop:id/btn_checkout' } } },
    { id: 'e4', from: 'n_checkout', to: 'n_cart', action: { kind: 'back' } },
  ],
  flows: [
    { id: 'f_purchase', name: 'Purchase', edgeIds: ['e2', 'e3'], coverage: 'observed' },
  ],
  frontier: [],
};

describe('props serialization', () => {
  it('maps bindings, actions, and literals', () => {
    expect(propExpr('$state.cart.items')).toBe(`resolve("$state.cart.items")`);
    expect(propExpr({ navigate: 'cart' })).toBe(`() => router.push('/cart')`);
    expect(propExpr({ back: true })).toBe(`() => router.back()`);
    expect(propExpr({ submit: true })).toBe(`() => submit()`);
    expect(propExpr('Checkout')).toBe(`"Checkout"`);
    expect(propExpr(2)).toBe('2');
    expect(propsToJsx({ label: 'Go', onPress: { navigate: 'cart' }, emphasis: true })).toBe(
      ` label="Go" onPress={() => router.push('/cart')} emphasis={true}`,
    );
  });

  it('maps refs to component names with clash exceptions', () => {
    expect(componentName('oas/cart-item-list')).toBe('CartItemList');
    expect(componentName('oas/image')).toBe('ImageBlock');
    expect(componentName('oas/list')).toBe('List');
  });
});

describe('generateProject', () => {
  const spec = compileBlueprint(SHOP_IFG, { runId: 'r1' });
  const files = generateProject(spec, { ifg: SHOP_IFG });
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  it('emits a complete expo-router project', () => {
    for (const required of [
      'package.json',
      'app.json',
      'tsconfig.json',
      'app/_layout.tsx',
      'app/index.tsx',
      'app/fakeshop_home.tsx',
      'app/shopping_cart.tsx',
      'app/checkout_payment.tsx',
      'components/oas.tsx',
      'theme/tokens.ts',
      'state/app-data.ts',
      'README.md',
    ]) {
      expect(byPath.has(required), required).toBe(true);
    }
    const pkg = JSON.parse(byPath.get('package.json')!);
    expect(pkg.main).toBe('expo-router/entry');
    expect(pkg.dependencies['expo-router']).toBeDefined();
    const appConfig = JSON.parse(byPath.get('app.json')!);
    expect(appConfig.expo.android.package).toBe('dev.openappstudio.fakeshop');
  });

  it('renders tab navigation with hidden non-tab routes', () => {
    const layout = byPath.get('app/_layout.tsx')!;
    expect(layout).toContain('<Tabs');
    expect(layout).toContain('name="fakeshop_home"');
    expect(layout).toContain('name="checkout_payment" options={{ title: "Checkout — payment", href: null }}');
    expect(byPath.get('app/index.tsx')).toContain('<Redirect href="/fakeshop_home" />');
  });

  it('wires screen components, bindings, and navigation', () => {
    const cart = byPath.get('app/shopping_cart.tsx')!;
    expect(cart).toContain(`<CartItemList items={resolve("$state.cart.items")} />`);
    expect(cart).toContain(`onPress={() => router.push('/checkout_payment')}`);
    expect(cart).toContain(`import { resolve } from '../state/app-data';`);
    // checkout screen uses submit but no router navigation
    const checkout = byPath.get('app/checkout_payment.tsx')!;
    expect(checkout).toContain('function submit()');
    expect(checkout).not.toContain('router.push');
  });

  it('seeds demo data for every referenced binding', () => {
    const data = byPath.get('state/app-data.ts')!;
    expect(data).toContain('"$state.cart.items"');
    expect(data).toContain('"$state.cart.total"');
    expect(data).toContain('"$data.results"');
  });

  it('re-targets IFG flows as Maestro e2e tests against the generated UI', () => {
    const yaml = byPath.get('e2e/f_purchase.yaml')!;
    expect(yaml).toContain('appId: dev.openappstudio.fakeshop');
    expect(yaml).toContain('- launchApp');
    expect(yaml).toContain('- tapOn: "Checkout"');
    // the home→cart hop is a tab in the generated app
    expect(yaml).toContain('- tapOn: "Cart"');
    expect(yaml).not.toContain('WARNING');
  });

  it('is deterministic', () => {
    const again = generateProject(compileBlueprint(SHOP_IFG, { runId: 'r1' }), { ifg: SHOP_IFG });
    expect(again).toEqual(files);
  });
});
