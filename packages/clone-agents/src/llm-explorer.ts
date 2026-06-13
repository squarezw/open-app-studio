import type { ChatMessage, LlmClient } from '@oas/llm';
import { heuristicDecide, type Decider, type Decision, type DecisionContext } from './heuristic-explorer.js';

/**
 * Goal-directed LLM Explorer brain. Given the current screen's candidate
 * actions, the goal, and recent history, the model picks the next action with
 * reasoning — semantic judgment the keyword policy can't do ("this looks like
 * the product detail, tap Add to cart to advance the purchase flow").
 *
 * Robust + economical:
 *  - falls back to the heuristic policy on any error or unconfigured client;
 *  - skips the LLM call when there's ≤1 candidate (nothing to deliberate);
 *  - the heuristic score travels in the prompt as a prior, so the model
 *    starts from the policy's ranking and overrides only with reason.
 */
const SYSTEM = `You drive an automated explorer through a mobile app, one screen at a time, to map its interaction flows.

Your priorities, in order:
1. Cover the app's CORE user flows: browse/search → product/detail → add to cart → cart → checkout (STOP before paying); and account sign-up / log-in.
2. Reach NEW screens (breadth) before re-treading seen ones.
3. Avoid dwelling in utility/dead-end areas: barcode scanner, share/refer, notifications, settings, language, help, legal.

You are given the screen title, how many times you've seen it, recent history, and a numbered list of candidate actions (each with a heuristic score; higher = more promising).

Reply with ONE JSON object:
{"action":"tap"|"type"|"back"|"stop","index":<candidate index for tap/type>,"value":"<text for type>","reason":"<short>"}
- tap: activate candidate[index].
- type: enter text into candidate[index] (a search/input field). Provide a realistic "value" (e.g. a product term for search). Never real credentials.
- back: this screen is a dead-end or off-path; go back.
- stop: the core flows are sufficiently covered.
Choose the single best next action.`;

export interface LlmDeciderOptions {
  /** Fallback when the LLM is unavailable or errors. Defaults to the heuristic policy. */
  fallback?: Decider;
  /**
   * Economical mode (default true): when the heuristic policy has a clear
   * winner (top score beats the runner-up by `margin`), take it WITHOUT calling
   * the LLM — only deliberate with the model when the choice is genuinely
   * ambiguous. This is the LLM-Explorer cost model (LLM-less action selection
   * for the easy majority; the LLM for the hard cases) — far cheaper than
   * calling the model every step. Set false to always ask the LLM.
   */
  economical?: boolean;
  /** Score margin that counts as a "clear winner" in economical mode. */
  margin?: number;
  log?: (message: string) => void;
}

export function makeLlmDecider(llm: LlmClient, opts: LlmDeciderOptions = {}): Decider {
  const fallback = opts.fallback ?? heuristicDecide;
  const economical = opts.economical ?? true;
  const margin = opts.margin ?? 2;
  const log = opts.log ?? (() => {});

  return async (ctx: DecisionContext): Promise<Decision> => {
    if (!llm.configured || ctx.candidates.length <= 1) return fallback(ctx);

    // Cost control: skip the LLM when the policy is confident (one candidate
    // clearly outscores the rest). Most screens have an obvious next action.
    if (economical) {
      const sorted = [...ctx.candidates].sort((a, b) => b.score - a.score);
      if (sorted[0]!.score - sorted[1]!.score >= margin) {
        const best = sorted[0]!;
        return best.editable ? { act: 'type', index: best.index } : { act: 'tap', index: best.index };
      }
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: renderContext(ctx) },
    ];
    try {
      const reply = await llm.chatJson<{ action?: string; index?: number; value?: string; reason?: string }>(messages, {
        temperature: 0.2,
        maxTokens: 400,
      });
      const action = reply.action;
      if (action === 'back') return { act: 'back', reason: reply.reason };
      if (action === 'stop') return { act: 'stop', reason: reply.reason };
      if ((action === 'tap' || action === 'type') && typeof reply.index === 'number' && ctx.candidates[reply.index]) {
        return action === 'type'
          ? { act: 'type', index: reply.index, value: reply.value, reason: reply.reason }
          : { act: 'tap', index: reply.index, reason: reply.reason };
      }
      log(`llm decider: unusable reply ${JSON.stringify(reply)} — falling back`);
      return fallback(ctx);
    } catch (err) {
      log(`llm decider error: ${err instanceof Error ? err.message : err} — falling back`);
      return fallback(ctx);
    }
  };
}

function renderContext(ctx: DecisionContext): string {
  const lines: string[] = [];
  if (ctx.goal) lines.push(`Goal: ${ctx.goal}`);
  lines.push(`Screen: ${ctx.screen.title ?? '(untitled)'} — seen ${ctx.screen.visits}× so far`);
  if (ctx.history.length > 0) lines.push(`Recent path:\n${ctx.history.map((h) => `  - ${h}`).join('\n')}`);
  lines.push('Candidates (idx · label · kind · screen-position · score):');
  for (const c of ctx.candidates) {
    const kind = c.editable ? 'text-field' : c.dropdown ? 'dropdown' : 'tap';
    // Enrich with current text + vertical position so elements that share one
    // resourceId (same label) are still distinguishable (AppAgent-v2 style).
    const valued = c.text && c.text !== c.label ? ` value="${c.text}"` : '';
    const pos = c.yFraction <= 0.25 ? 'top' : c.yFraction >= 0.8 ? 'bottom' : 'mid';
    lines.push(`  [${c.index}] "${c.label}" · ${kind}${valued} · ${pos} · score ${c.score}`);
  }
  return lines.join('\n');
}
