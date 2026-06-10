import { pathTo, type Flow, type InteractionFlowGraph, type ScreenRole } from '@oas/flow-graph';

/**
 * Annotator v0 — deterministic, keyword-based screen-role tagging and flow
 * naming. The M2+ LLM Annotator replaces the role table with semantic judgment
 * (and adds component-pattern detection); the IFG contract stays the same.
 */

const ROLE_KEYWORDS: Array<[ScreenRole, RegExp]> = [
  ['auth', /\b(login|log in|sign in|signin|sign up|register|password)\b|登录|注册|密码/i],
  ['checkout', /\b(checkout|payment|pay now|place order)\b|结算|支付|下单/i],
  ['cart', /\b(cart|basket|bag)\b|购物车/i],
  ['search', /\b(search)\b|搜索/i],
  ['settings', /\b(settings|preferences)\b|设置/i],
  ['profile', /\b(profile|account|my )\b|我的|个人中心|账户/i],
  ['onboarding', /\b(welcome|get started|onboarding|skip intro)\b|欢迎|引导/i],
];

/** Mutates `ifg`: fills node.role (where confidently guessable) from titles, route hints, and action labels. */
export function annotate(ifg: InteractionFlowGraph): void {
  for (const node of ifg.nodes) {
    if (node.role) continue;
    const signals: string[] = [];
    if (node.title) signals.push(node.title);
    if (node.routeHint) signals.push(node.routeHint);
    for (const edge of ifg.edges) {
      // Labels of actions LEADING INTO a screen describe it well ("tap Cart" → cart screen).
      if (edge.to !== node.id || edge.from === node.id) continue;
      const s = edge.action.selector;
      signals.push(...[s?.text, s?.resourceId, s?.accessibilityId].filter((v): v is string => !!v));
    }
    const haystack = signals.join(' ');
    const match = ROLE_KEYWORDS.find(([, re]) => re.test(haystack));
    if (match) node.role = match[0];
  }
  const launch = ifg.nodes[0];
  if (launch && !launch.role) launch.role = 'launch';
}

/** Derives named flows: shortest observed path from launch to each role-tagged screen. */
export function deriveFlows(ifg: InteractionFlowGraph): Flow[] {
  const flows: Flow[] = [];
  for (const node of ifg.nodes) {
    if (!node.role || node.role === 'launch' || node.role === 'other') continue;
    const path = pathTo(ifg, node.id);
    if (!path || path.length === 0) continue;
    flows.push({
      id: `f_${node.role}_${node.id}`,
      name: `To ${node.title ?? node.role}`,
      description: `Shortest observed path to the ${node.role} screen (${path.length} step${path.length > 1 ? 's' : ''})`,
      edgeIds: path.map((e) => e.id),
      coverage: 'observed',
    });
  }
  return flows;
}
