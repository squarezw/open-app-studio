import { describe, expect, it } from 'vitest';
import type { ComponentManifest } from '@oas/component-registry';
import { LlmClient } from '@oas/llm';
import { generateComponent } from '../src/generator.js';
import { componentName, sandboxCheck } from '../src/sandbox.js';

const GOOD_MANIFEST: ComponentManifest = {
  ref: 'custom/stat-ring',
  name: 'Stat Ring',
  description: 'Circular stat display',
  patterns: ['chart'],
  props: [{ name: 'value', type: 'number', required: true }],
};

const GOOD_TSX = `import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme/tokens';

export function StatRing({ value }: { value: number }) {
  return (
    <View style={s.ring} accessibilityRole="text">
      <Text style={s.value}>{value}%</Text>
    </View>
  );
}

const s = StyleSheet.create({
  ring: { width: 96, height: 96, borderRadius: 48, borderWidth: 6, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', margin: spacing.sm },
  value: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
`;

describe('sandboxCheck', () => {
  it('passes a well-formed component', () => {
    expect(sandboxCheck(GOOD_MANIFEST, GOOD_TSX)).toEqual([]);
  });

  it('rejects bad refs, unknown patterns, and missing export', () => {
    const errors = sandboxCheck(
      { ...GOOD_MANIFEST, ref: 'oas/hack', patterns: ['nonsense' as never] },
      'export const x = 1;',
    );
    expect(errors.join('\n')).toMatch(/custom\/<kebab-case>/);
    expect(errors.join('\n')).toMatch(/unknown pattern kind/);
    expect(errors.join('\n')).toMatch(/export function Hack/);
  });

  it('rejects disallowed imports and banned constructs', () => {
    const evil = `import axios from 'axios';
export function StatRing() { fetch('https://x'); return null; }`;
    const errors = sandboxCheck(GOOD_MANIFEST, evil);
    expect(errors.join('\n')).toMatch(/import "axios" is not allowed/);
    expect(errors.join('\n')).toMatch(/banned construct/);
  });

  it('rejects syntactically broken TSX', () => {
    const errors = sandboxCheck(GOOD_MANIFEST, 'export function StatRing( { return <View; }');
    expect(errors.some((e) => e.startsWith('TSX error'))).toBe(true);
  });

  it('maps refs to component names', () => {
    expect(componentName('custom/stat-ring')).toBe('StatRing');
    expect(componentName('custom/gradient-progress-ring')).toBe('GradientProgressRing');
  });
});

describe('generateComponent repair loop', () => {
  function llmReturning(...replies: unknown[]): LlmClient {
    let i = 0;
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies[Math.min(i++, replies.length - 1)]) } }] }),
        { status: 200 },
      )) as typeof fetch;
    return new LlmClient({ apiKey: 'test', fetchImpl });
  }

  it('accepts a clean first attempt', async () => {
    const result = await generateComponent(llmReturning({ manifest: GOOD_MANIFEST, tsx: GOOD_TSX }), 'a stat ring');
    expect(result.attempts).toBe(1);
    expect(result.component.manifest.ref).toBe('custom/stat-ring');
  });

  it('feeds sandbox errors back and succeeds on retry', async () => {
    const bad = { manifest: GOOD_MANIFEST, tsx: `import axios from 'axios';\nexport function StatRing() { return null; }` };
    const result = await generateComponent(llmReturning(bad, { manifest: GOOD_MANIFEST, tsx: GOOD_TSX }), 'a stat ring');
    expect(result.attempts).toBe(2);
  });

  it('gives up after maxAttempts with the last errors', async () => {
    const bad = { manifest: GOOD_MANIFEST, tsx: 'export const nope = 1;' };
    await expect(generateComponent(llmReturning(bad), 'x', { maxAttempts: 2 })).rejects.toThrow(
      /failed after 2 attempts[\s\S]*export function StatRing/,
    );
  });
});
