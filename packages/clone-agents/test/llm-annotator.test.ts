import { describe, expect, it } from 'vitest';
import { LlmClient } from '@oas/llm';
import type { InteractionFlowGraph } from '@oas/flow-graph';
import { makeLlmAnnotator } from '../src/llm-annotator.js';

function fakeLlm(content: string): LlmClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return new LlmClient({ apiKey: 'test', baseUrl: 'http://llm.test', model: 'deepseek-chat', fetchImpl });
}

function ifg(): InteractionFlowGraph {
  return {
    version: '0.1',
    meta: { appName: 'x', platform: 'android-emulator' },
    nodes: [
      { id: 'n1', fingerprint: 'a', title: 'Home', role: 'launch', visits: 1 },
      { id: 'n2', fingerprint: 'b', title: 'Bag', visits: 1 }, // keyword missed it
      { id: 'n3', fingerprint: 'c', title: 'Pay now', role: 'other', visits: 1 },
    ],
    edges: [],
    frontier: [],
  } as unknown as InteractionFlowGraph;
}

describe('makeLlmAnnotator', () => {
  it('refines screen roles via the LLM, never overriding launch', async () => {
    const annotate = makeLlmAnnotator(
      fakeLlm('{"roles":[{"id":"n1","role":"cart"},{"id":"n2","role":"cart"},{"id":"n3","role":"checkout"}]}'),
    );
    const g = ifg();
    await annotate(g);
    const role = (id: string) => g.nodes.find((n) => n.id === id)!.role;
    expect(role('n1')).toBe('launch'); // launch node is never relabeled
    expect(role('n2')).toBe('cart'); // LLM tagged a screen the keywords missed
    expect(role('n3')).toBe('checkout'); // LLM overrode the weak 'other'
  });

  it('keeps existing roles when the LLM returns an invalid role or errors', async () => {
    const g = ifg();
    g.nodes[1]!.role = 'list';
    await makeLlmAnnotator(fakeLlm('{"roles":[{"id":"n2","role":"bogus"}]}'))(g);
    expect(g.nodes[1]!.role).toBe('list'); // invalid role ignored
  });

  it('is a no-op when the LLM is not configured', async () => {
    const annotate = makeLlmAnnotator(new LlmClient({ apiKey: undefined }));
    const g = ifg();
    await annotate(g);
    expect(g.nodes[1]!.role).toBeUndefined();
  });
});
