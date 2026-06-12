/**
 * Minimal, provider-agnostic LLM client over the OpenAI-compatible
 * chat-completions protocol. DeepSeek by default; works with OpenAI, Ollama,
 * vLLM, or any compatible endpoint. No SDK dependency — plain fetch.
 *
 * Config (constructor overrides env):
 *   OAS_LLM_API_KEY   — required for hosted providers
 *   OAS_LLM_BASE_URL  — default https://api.deepseek.com
 *   OAS_LLM_MODEL     — default deepseek-chat
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export interface ChatOptions {
  /** Ask the provider for a JSON object response. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export class LlmClient {
  private readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: LlmConfig = {}) {
    this.apiKey = cfg.apiKey ?? process.env.OAS_LLM_API_KEY;
    this.baseUrl = (cfg.baseUrl ?? process.env.OAS_LLM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
    this.model = cfg.model ?? process.env.OAS_LLM_MODEL ?? 'deepseek-chat';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    if (!this.configured) {
      throw new Error('LLM not configured — set OAS_LLM_API_KEY (see .env.example)');
    }
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM request failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned an empty response');
    return content;
  }

  /** chat() in JSON mode with robust parsing (strips markdown fences if present). */
  async chatJson<T>(messages: ChatMessage[], opts: Omit<ChatOptions, 'json'> = {}): Promise<T> {
    const raw = await this.chat(messages, { ...opts, json: true });
    const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}…`);
    }
  }
}
