import { describe, expect, it, vi } from 'vitest';
import { LlmClient } from '@oas/llm';
import { makeLlmDecider } from '../src/llm-explorer.js';
import type { Candidate, DecisionContext } from '../src/heuristic-explorer.js';

function candidate(index: number, label: string, score: number, editable = false): Candidate {
  return { index, label, hint: label.toLowerCase(), editable, score, selector: { text: label }, center: { x: 0, y: index * 100 } };
}

function ctx(candidates: Candidate[]): DecisionContext {
  return { goal: 'test goal', screen: { title: 'Home', visits: 1 }, candidates, history: [] };
}

function llmReturning(content: unknown): LlmClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 })) as typeof fetch;
  return new LlmClient({ apiKey: 'test', fetchImpl });
}

const TWO = [candidate(0, 'Cart', 3), candidate(1, 'Scan', -3)];

describe('makeLlmDecider', () => {
  it('uses the LLM choice when valid', async () => {
    const decide = makeLlmDecider(llmReturning({ action: 'tap', index: 1, reason: 'curious' }));
    expect(await decide(ctx(TWO))).toEqual({ act: 'tap', index: 1, reason: 'curious' });
  });

  it('maps back, stop, and type (with value)', async () => {
    expect(await makeLlmDecider(llmReturning({ action: 'back', reason: 'dead end' }))(ctx(TWO))).toEqual({ act: 'back', reason: 'dead end' });
    expect(await makeLlmDecider(llmReturning({ action: 'stop' }))(ctx(TWO))).toMatchObject({ act: 'stop' });
    const field = [candidate(0, 'Search', 3, true), candidate(1, 'Cart', 3)];
    expect(await makeLlmDecider(llmReturning({ action: 'type', index: 0, value: 'omega 3' }))(ctx(field))).toEqual({
      act: 'type',
      index: 0,
      value: 'omega 3',
      reason: undefined,
    });
  });

  it('skips the LLM (no call) when ≤1 candidate and falls back to heuristic', async () => {
    const llm = llmReturning({ action: 'tap', index: 0 });
    const spy = vi.spyOn(llm, 'chatJson');
    const decide = makeLlmDecider(llm);
    expect(await decide(ctx([candidate(0, 'OnlyOne', 1)]))).toEqual({ act: 'tap', index: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to heuristic on an out-of-range index', async () => {
    const decide = makeLlmDecider(llmReturning({ action: 'tap', index: 99 }));
    // heuristic picks the highest score → Cart (index 0)
    expect(await decide(ctx(TWO))).toEqual({ act: 'tap', index: 0 });
  });

  it('falls back to heuristic on LLM/transport error', async () => {
    const failing = new LlmClient({ apiKey: 'k', fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch });
    const decide = makeLlmDecider(failing);
    expect(await decide(ctx(TWO))).toEqual({ act: 'tap', index: 0 });
  });

  it('falls back when the client is unconfigured', async () => {
    if (process.env.OAS_LLM_API_KEY) return; // env-configured in this shell; skip
    const decide = makeLlmDecider(new LlmClient({ apiKey: undefined }));
    expect(await decide(ctx(TWO))).toEqual({ act: 'tap', index: 0 });
  });
});
