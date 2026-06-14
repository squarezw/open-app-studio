import type { LlmClient } from '@oas/llm';
import type { InteractionFlowGraph, ScreenRole } from '@oas/flow-graph';

/**
 * LLM Annotator — semantic screen-role tagging, replacing the keyword table in
 * annotator.ts with the model's judgment. Runs once after the keyword pass
 * (which stays as the baseline / fallback), in a SINGLE batched call: every
 * screen's title + route hint + inbound action labels go in, a role per screen
 * comes back. Text-only (DeepSeek) — roles are a semantic call the title/route/
 * context already carry, so we don't spend a vision call per screen here.
 */

const ROLES: readonly ScreenRole[] = [
  'launch', 'onboarding', 'auth', 'feed', 'list', 'detail', 'form',
  'cart', 'checkout', 'settings', 'profile', 'search', 'modal', 'webview', 'other',
];

const SYSTEM = `You label screens of a mobile app with ONE semantic role each.
Roles: ${ROLES.join(', ')}.
Guidance: feed/list = browse grids or lists; detail = a single product/item page; form = data entry (address, etc.); cart = the shopping bag; checkout = payment/place-order; auth = login/register; search = search box or results; profile = account/"me"; settings = preferences; onboarding = welcome/intro; modal = a dialog/sheet; webview = embedded web; other = none of these.
Input: a JSON array of screens, each { id, title, route, via } where "via" lists labels of actions that navigated INTO the screen.
Reply with JSON ONLY: {"roles":[{"id":"<id>","role":"<role>"}, ...]} — one entry per input screen. Never assign "launch". Use "other" when unclear.`;

export interface LlmAnnotatorOptions {
  log?: (message: string) => void;
}

/** Returns an annotator that refines roles via the LLM, or a no-op if unconfigured. */
export function makeLlmAnnotator(llm: LlmClient, opts: LlmAnnotatorOptions = {}): (ifg: InteractionFlowGraph) => Promise<void> {
  const log = opts.log ?? (() => {});
  const valid = new Set<string>(ROLES);

  return async (ifg: InteractionFlowGraph): Promise<void> => {
    if (!llm.configured) return;
    const launchId = ifg.nodes[0]?.id;
    const screens = ifg.nodes
      .filter((n) => n.id !== launchId)
      .map((n) => ({
        id: n.id,
        title: n.title ?? '',
        route: n.routeHint ?? '',
        via: ifg.edges
          .filter((e) => e.to === n.id && e.from !== n.id)
          .map((e) => e.action.selector?.text ?? e.action.selector?.resourceId?.split('/').pop())
          .filter((v): v is string => Boolean(v))
          .slice(0, 4),
      }));
    if (screens.length === 0) return;

    try {
      const result = await llm.chatJson<{ roles?: Array<{ id: string; role: string }> }>(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify({ screens }) },
        ],
        { temperature: 0 },
      );
      let tagged = 0;
      for (const { id, role } of result.roles ?? []) {
        if (id === launchId) continue; // the launch node keeps its role
        const node = ifg.nodes.find((n) => n.id === id);
        if (node && role !== 'launch' && valid.has(role)) {
          node.role = role as ScreenRole;
          tagged += 1;
        }
      }
      log(`LLM annotator tagged ${tagged}/${screens.length} screens`);
    } catch (err) {
      // Keep the keyword roles already set; never fail a run over annotation.
      log(`LLM annotator skipped (keyword roles kept): ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
