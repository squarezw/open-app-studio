import { byPattern, forRole } from '@oas/component-registry';
import {
  subgraph,
  type ActionEdge,
  type ComponentPattern,
  type InteractionFlowGraph,
  type ScreenNode,
  type ScreenRole,
} from '@oas/flow-graph';
import type {
  AppSpec,
  ComponentInstance,
  ModelSpec,
  NavigationSpec,
  ScreenSpec,
  TabSpec,
} from './types.js';

/**
 * Blueprint Compiler — turns observed behavior (IFG) into a buildable draft
 * (App Spec). Deterministic and rule-based in M2: screen roles pick default
 * blocks, component patterns refine them, forward edges become navigation.
 * The draft is a starting point the user edits on the canvas — never a final
 * answer. An LLM refinement pass (visual matching, copy) layers on in M3.
 */
export interface BlueprintOptions {
  /** Compile only this subgraph (e.g. one user flow). */
  nodeIds?: string[];
  appName?: string;
  runId?: string;
}

export function compileBlueprint(input: InteractionFlowGraph, opts: BlueprintOptions = {}): AppSpec {
  const ifg = opts.nodeIds ? subgraph(input, opts.nodeIds) : input;
  if (ifg.nodes.length === 0) throw new Error('compileBlueprint: graph has no nodes');

  const screenIds = assignScreenIds(ifg.nodes);
  const launch = ifg.nodes[0]!;
  const tabs = detectTabs(ifg, launch, screenIds);
  const tabTargets = new Set(tabs?.map((t) => t.screenId) ?? []);

  const models: ModelSpec[] = [];
  const screens: ScreenSpec[] = ifg.nodes.map((node) => {
    const id = screenIds.get(node.id)!;
    const components = [
      ...componentsForRole(node, models, id),
      ...componentsForPatterns(node),
      ...navButtons(ifg, node, screenIds, node.id === launch.id ? tabTargets : new Set()),
    ];
    return {
      id,
      title: node.title ?? id,
      role: node.role,
      components: components.length > 0 ? components : [{ ref: 'oas/text-block', props: { text: node.title ?? id } }],
    };
  });

  const navigation: NavigationSpec = tabs
    ? { type: 'tabs', tabs }
    : { type: 'stack', initial: screenIds.get(launch.id)! };

  const sourceNodeIds: Record<string, string> = {};
  for (const [nodeId, screenId] of screenIds) sourceNodeIds[screenId] = nodeId;

  return {
    version: '0.1',
    app: {
      name: opts.appName ?? `${ifg.meta.appName} Clone`,
      appId: suggestAppId(ifg.meta.appName),
      // Design tokens extracted from screenshots, if any (else codegen's default theme).
      ...(ifg.meta.theme && (ifg.meta.theme.colors || ifg.meta.theme.radii) ? { theme: ifg.meta.theme } : {}),
    },
    navigation,
    screens,
    ...(models.length > 0 ? { data: { models } } : {}),
    meta: {
      generatedFrom: 'ifg',
      ...(opts.runId ? { sourceRunId: opts.runId } : {}),
      ...(ifg.meta.storeUrl ? { sourceStoreUrl: ifg.meta.storeUrl } : {}),
      sourceNodeIds,
    },
  };
}

/** Stable, schema-valid (^[a-z][a-z0-9_]*$), unique screen ids from titles. */
function assignScreenIds(nodes: ScreenNode[]): Map<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const node of nodes) {
    let base = slugify(node.title ?? node.role ?? node.id);
    if (!/^[a-z]/.test(base)) base = `s_${base}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    ids.set(node.id, id);
  }
  return ids;
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return slug || 'screen';
}

/**
 * Tab detection: the launch screen fanning out to 2–5 distinct screens via
 * taps is the signature of a tab bar (or a hub home — same draft either way).
 */
function detectTabs(
  ifg: InteractionFlowGraph,
  launch: ScreenNode,
  screenIds: Map<string, string>,
): TabSpec[] | undefined {
  const targets = new Map<string, ActionEdge>();
  for (const e of forwardEdges(ifg, launch.id)) {
    if (!targets.has(e.to)) targets.set(e.to, e);
  }
  if (targets.size < 2 || targets.size > 5) return undefined;
  const tabs: TabSpec[] = [
    { id: screenIds.get(launch.id)!, screenId: screenIds.get(launch.id)!, label: launch.title ?? 'Home', icon: 'home' },
  ];
  for (const [to, edge] of targets) {
    const screenId = screenIds.get(to)!;
    tabs.push({ id: screenId, screenId, label: edgeText(edge) ?? screenId });
  }
  return tabs.slice(0, 5);
}

function forwardEdges(ifg: InteractionFlowGraph, fromId: string): ActionEdge[] {
  return ifg.edges.filter(
    (e) => e.from === fromId && e.to !== fromId && (e.action.kind === 'tap' || e.action.kind === 'longPress'),
  );
}

function edgeText(e: ActionEdge): string | undefined {
  const s = e.action.selector;
  if (s?.text) return s.text;
  if (s?.resourceId) return humanize(s.resourceId.split('/').pop() ?? '');
  if (s?.accessibilityId) return s.accessibilityId;
  return undefined;
}

function humanize(id: string): string {
  return id
    .replace(/^(btn|button|txt|img|lbl)_?/i, '')
    .split(/[_\-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Role → default blocks. Collects observed form fields into data models. */
function componentsForRole(node: ScreenNode, models: ModelSpec[], screenId: string): ComponentInstance[] {
  const role = node.role;
  switch (role) {
    case 'auth': {
      const fields = formFields(node) ?? [
        { name: 'email', label: 'Email', keyboard: 'email', required: true },
        { name: 'password', label: 'Password', keyboard: 'password', required: true },
      ];
      pushModel(models, screenId, fields);
      return [
        { ref: 'oas/form-group', props: { fields, onSubmit: { submit: true } } },
        { ref: 'oas/button-primary', props: { label: node.title ?? 'Sign in', onPress: { submit: true } } },
      ];
    }
    case 'feed':
      return [{ ref: 'oas/infinite-feed', props: { items: '$data.feed' } }];
    case 'list':
      return [{ ref: 'oas/list', props: { items: '$data.items' } }];
    case 'search':
      return [
        { ref: 'oas/search-bar', props: {} },
        { ref: 'oas/list', props: { items: '$data.results' } },
      ];
    case 'cart':
      return [
        { ref: 'oas/cart-item-list', props: { items: '$state.cart.items' } },
        { ref: 'oas/price-row', props: { label: 'Total', amount: '$state.cart.total', emphasis: true } },
      ];
    case 'checkout':
      return [{ ref: 'oas/checkout-summary', props: { items: '$state.cart.items', onPay: { submit: true } } }];
    case 'settings':
      return [{ ref: 'oas/settings-list', props: { items: '$data.settings' } }];
    case 'profile':
      return [
        { ref: 'oas/avatar-header', props: { name: '$user.name', avatarUrl: '$user.avatar' } },
        { ref: 'oas/settings-list', props: { items: '$data.profileItems' } },
      ];
    case 'detail':
      return [
        { ref: 'oas/detail-header', props: { title: '$item.title', imageUrl: '$item.image' } },
        { ref: 'oas/text-block', props: { text: '$item.description' } },
      ];
    case 'form': {
      const fields = formFields(node);
      if (fields) pushModel(models, screenId, fields);
      return [{ ref: 'oas/form-group', props: { fields: fields ?? [], onSubmit: { submit: true } } }];
    }
    case 'onboarding':
      return [
        { ref: 'oas/carousel', props: { items: '$data.onboardingSlides' } },
        { ref: 'oas/button-primary', props: { label: 'Get started', onPress: { navigate: screenId } } },
      ];
    case 'modal':
      return [{ ref: 'oas/dialog', props: { title: node.title ?? 'Confirm' } }];
    case 'webview':
      return [{ ref: 'oas/web-view', props: { url: '$data.url' } }];
    default:
      return [];
  }
}

/** Observed pattern tags add blocks the role template didn't already provide. */
function componentsForPatterns(node: ScreenNode): ComponentInstance[] {
  const out: ComponentInstance[] = [];
  const roleRefs = new Set(componentRefsForRole(node.role));
  for (const p of node.patterns ?? []) {
    if (p.kind === 'tabbar' || p.kind === 'navbar' || p.kind === 'button' || p.kind === 'other') continue;
    const candidate = byPattern(p.kind, node.role)[0];
    if (!candidate || roleRefs.has(candidate.ref)) continue;
    roleRefs.add(candidate.ref);
    out.push({ ref: candidate.ref, props: {} });
  }
  return out;
}

function componentRefsForRole(role: ScreenRole | undefined): string[] {
  if (!role) return [];
  return forRole(role).map((m) => m.ref);
}

/** Forward edges become navigation buttons (tab edges are covered by the tab bar). */
function navButtons(
  ifg: InteractionFlowGraph,
  node: ScreenNode,
  screenIds: Map<string, string>,
  skipTargets: Set<string>,
): ComponentInstance[] {
  const seen = new Set<string>();
  const out: ComponentInstance[] = [];
  for (const e of forwardEdges(ifg, node.id)) {
    const targetScreen = screenIds.get(e.to);
    if (!targetScreen || skipTargets.has(targetScreen) || seen.has(targetScreen)) continue;
    seen.add(targetScreen);
    out.push({
      ref: 'oas/button-primary',
      props: { label: edgeText(e) ?? targetScreen, onPress: { navigate: targetScreen } },
    });
  }
  return out;
}

interface FieldSeed {
  name: string;
  label: string;
  keyboard?: string;
  required?: boolean;
}

function formFields(node: ScreenNode): FieldSeed[] | undefined {
  const form = node.patterns?.find((p: ComponentPattern) => p.kind === 'form' && (p.fields?.length ?? 0) > 0);
  if (!form?.fields) return undefined;
  return form.fields.map((f, i) => ({
    name: slugify(f.label ?? `field_${i + 1}`),
    label: f.label ?? `Field ${i + 1}`,
    keyboard: f.keyboard,
    required: f.required,
  }));
}

function pushModel(models: ModelSpec[], screenId: string, fields: FieldSeed[]): void {
  models.push({
    name: pascal(screenId),
    fields: fields.map((f) => ({
      name: f.name,
      type: f.keyboard === 'number' ? ('float' as const) : f.keyboard === 'url' ? ('url' as const) : ('string' as const),
      required: f.required,
    })),
  });
}

function pascal(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function suggestAppId(appName: string): string {
  const tail = slugify(appName).replace(/_/g, '') || 'app';
  return `dev.openappstudio.${tail}`;
}
