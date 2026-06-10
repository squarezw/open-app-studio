import { describe, expect, it } from 'vitest';
import { LlmClient, type ChatMessage } from '../src/index.js';

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hi' }];

function fakeFetch(reply: unknown, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    lastCall = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: init?.headers as Record<string, string> };
    return new Response(JSON.stringify(reply), { status });
  }) as typeof fetch;
}
let lastCall: { url: string; body: Record<string, unknown>; headers: Record<string, string> };

describe('LlmClient', () => {
  it('sends OpenAI-compatible requests with auth', async () => {
    const client = new LlmClient({
      apiKey: 'k',
      baseUrl: 'https://api.deepseek.com/',
      model: 'deepseek-chat',
      fetchImpl: fakeFetch({ choices: [{ message: { content: 'hello' } }] }),
    });
    expect(await client.chat(MESSAGES)).toBe('hello');
    expect(lastCall.url).toBe('https://api.deepseek.com/chat/completions');
    expect(lastCall.body.model).toBe('deepseek-chat');
    expect(lastCall.headers.authorization).toBe('Bearer k');
  });

  it('requests json mode and parses fenced output', async () => {
    const client = new LlmClient({
      apiKey: 'k',
      fetchImpl: fakeFetch({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }),
    });
    expect(await client.chatJson(MESSAGES)).toEqual({ a: 1 });
    expect(lastCall.body.response_format).toEqual({ type: 'json_object' });
  });

  it('fails clearly when unconfigured or on HTTP errors', async () => {
    const unconfigured = new LlmClient({ apiKey: undefined, fetchImpl: fakeFetch({}) });
    if (!process.env.OAS_LLM_API_KEY) {
      expect(unconfigured.configured).toBe(false);
      await expect(unconfigured.chat(MESSAGES)).rejects.toThrow(/OAS_LLM_API_KEY/);
    }
    const failing = new LlmClient({ apiKey: 'k', fetchImpl: fakeFetch({ error: 'nope' }, 401) });
    await expect(failing.chat(MESSAGES)).rejects.toThrow(/HTTP 401/);
  });
});
