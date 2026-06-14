import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_TABBED_ENTRY_APP } from '@oas/device-bridge';
import { makeVlmAnalyzers } from '../src/entry-analyzer.js';

/** A fetch that returns a fixed VLM chat-completion response. */
function fakeVlmFetch(content: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

function tmpShot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oas-vlm-'));
  const p = join(dir, 'entry.png');
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // bytes don't matter — fetch is mocked
  return p;
}

describe('makeVlmAnalyzers', () => {
  it('returns undefined when no VLM endpoint is configured', () => {
    expect(makeVlmAnalyzers({ apiKey: undefined })).toBeUndefined();
  });

  it('maps VLM tab labels (semantics) onto uiTree selectors (operable)', async () => {
    const vlm = makeVlmAnalyzers({
      apiKey: 'test',
      baseUrl: 'http://vlm.test',
      model: 'qwen-vl-max',
      fetchImpl: fakeVlmFetch('{"appType":"e-commerce","hasTabBar":true,"tabs":["首页","搜索","购物车","我的"]}'),
    });
    expect(vlm).toBeDefined();

    const { analysis, tabs } = await vlm!.analyzeEntry(tmpShot(), DEMO_TABBED_ENTRY_APP.screens.ehome!);
    expect(analysis.appType).toBe('e-commerce');
    expect(analysis.hasTabBar).toBe(true);
    // VLM labels override the tree captions, but selectors come from the uiTree.
    expect(tabs?.map((t) => t.label)).toEqual(['首页', '搜索', '购物车', '我的']);
    expect(tabs?.[0]!.selector.resourceId).toBe('com.entry:id/nav_home');
    expect(tabs?.[2]!.selector.resourceId).toBe('com.entry:id/nav_cart');
  });

  it('analyzeTheme keeps only valid hex colors and sane radii', async () => {
    const vlm = makeVlmAnalyzers({
      apiKey: 'test',
      baseUrl: 'http://vlm.test',
      model: 'qwen-vl-max',
      fetchImpl: fakeVlmFetch('{"colors":{"accent":"#22aa55","bg":"not-a-color"},"radii":{"md":16,"sm":-3}}'),
    });
    const theme = await vlm!.analyzeTheme(tmpShot());
    expect(theme.colors).toEqual({ accent: '#22aa55' }); // bg dropped (invalid hex)
    expect(theme.radii).toEqual({ md: 16 }); // sm dropped (negative)
  });

  it('parses fenced JSON and reports no tabs when the screen has no bar', async () => {
    const vlm = makeVlmAnalyzers({
      apiKey: 'test',
      baseUrl: 'http://vlm.test',
      model: 'm',
      fetchImpl: fakeVlmFetch('```json\n{"appType":"tool","hasTabBar":false,"tabs":[]}\n```'),
    });
    const { analysis, tabs } = await vlm!.analyzeEntry(tmpShot(), DEMO_TABBED_ENTRY_APP.screens.promo!);
    expect(analysis.hasTabBar).toBe(false);
    expect(tabs).toBeUndefined();
  });
});
