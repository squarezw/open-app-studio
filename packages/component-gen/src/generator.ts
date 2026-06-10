import type { ComponentManifest } from '@oas/component-registry';
import type { ChatMessage, LlmClient } from '@oas/llm';
import { sandboxCheck } from './sandbox.js';

export interface GeneratedComponent {
  manifest: ComponentManifest;
  tsx: string;
}

export interface GenerateResult {
  component: GeneratedComponent;
  attempts: number;
}

const SYSTEM_PROMPT = `You generate React Native components for Open App Studio, an open-source app builder.

Respond with ONE JSON object: {"manifest": {...}, "tsx": "..."}

manifest rules:
- ref: "custom/<kebab-case-slug>" derived from the component's purpose
- name: short human label; description: one line
- patterns: 1-3 of [tabbar,navbar,drawer,list,grid,card,carousel,form,button,input,picker,map,video,chart,dialog,toast,empty,other]
- props: [{name, type: string|number|boolean|enum|binding|action|items, required?, default?, values?}] — every prop the tsx accepts, names unique

tsx rules:
- imports allowed ONLY from: 'react', 'react-native', '../theme/tokens'
- theme tokens: import { colors, spacing, radii } from '../theme/tokens'
  colors: bg panel border text muted accent onAccent success danger; spacing: xs sm md lg xl; radii: sm md lg
- MUST be: export function <PascalCase-of-ref-slug>(props) { ... } with typed props inline
- props-driven: no hardcoded user content; use StyleSheet.create; include accessibility props where natural
- NO fetch/eval/require/dynamic import/process/timers for I/O. Pure UI only.
- Self-contained single file. No default export.`;

/**
 * Generate → sandbox → repair loop. Sandbox errors are fed back to the model
 * verbatim; after maxAttempts the last errors are thrown. The accepted
 * component lands in the project registry only after a clean pass.
 */
export async function generateComponent(
  llm: LlmClient,
  prompt: string,
  opts: { maxAttempts?: number } = {},
): Promise<GenerateResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Component request: ${prompt}` },
  ];

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const reply = await llm.chatJson<{ manifest?: ComponentManifest; tsx?: string }>(messages, {
      temperature: 0.3,
      maxTokens: 4096,
    });
    if (!reply.manifest || typeof reply.tsx !== 'string') {
      lastErrors = ['response must be {"manifest": {...}, "tsx": "..."}'];
    } else {
      lastErrors = sandboxCheck(reply.manifest, reply.tsx);
      if (lastErrors.length === 0) {
        return { component: { manifest: reply.manifest, tsx: reply.tsx }, attempts: attempt };
      }
    }
    messages.push(
      { role: 'assistant', content: JSON.stringify(reply) },
      {
        role: 'user',
        content: `The sandbox rejected that. Fix ALL of these and respond with the full corrected JSON:\n- ${lastErrors.join('\n- ')}`,
      },
    );
  }
  throw new Error(`component generation failed after ${maxAttempts} attempts:\n- ${lastErrors.join('\n- ')}`);
}
