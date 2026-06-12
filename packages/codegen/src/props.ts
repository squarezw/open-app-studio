import type { ActionProp } from '@oas/app-spec';

/**
 * Serializes App Spec prop values into JSX attribute expressions.
 *
 *   "$state.cart.items"      → resolve('$state.cart.items')
 *   {navigate: 'cart'}       → () => router.push('/cart')
 *   {back: true}             → () => router.back()
 *   {submit: true}           → () => submit()
 *   "Checkout" / 3 / true    → literals
 *   [{...}] / {...}          → JSON expressions
 */
export function propExpr(value: unknown): string {
  if (typeof value === 'string') {
    return value.startsWith('$') ? `resolve(${JSON.stringify(value)})` : JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isAction(value)) {
    if ('navigate' in value) return `() => router.push('/${value.navigate}')`;
    if ('back' in value) return `() => router.back()`;
    return `() => submit()`;
  }
  return JSON.stringify(value);
}

export function propsToJsx(props: Record<string, unknown> | undefined): string {
  if (!props) return '';
  return Object.entries(props)
    .map(([key, value]) => {
      const expr = propExpr(value);
      // string literals can use plain attribute syntax
      if (typeof value === 'string' && !value.startsWith('$')) return ` ${key}=${expr}`;
      return ` ${key}={${expr}}`;
    })
    .join('');
}

function isAction(value: unknown): value is ActionProp {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && ['navigate', 'back', 'submit'].includes(keys[0]!);
}

/** Does any prop value reference a binding / action of the given kind? */
export function usesBinding(props: Record<string, unknown> | undefined): boolean {
  return Object.values(props ?? {}).some((v) => typeof v === 'string' && v.startsWith('$'));
}

export function usesRouter(props: Record<string, unknown> | undefined): boolean {
  return Object.values(props ?? {}).some((v) => isAction(v) && !('submit' in (v as object)));
}

export function usesSubmit(props: Record<string, unknown> | undefined): boolean {
  return Object.values(props ?? {}).some((v) => isAction(v) && 'submit' in (v as object));
}

/** "oas/cart-item-list" → "CartItemList" (with RN name-clash exceptions). */
export function componentName(ref: string): string {
  const tail = ref.split('/').pop()!;
  const pascal = tail
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return pascal === 'Image' ? 'ImageBlock' : pascal;
}
