import { readFile } from 'node:fs/promises';
import { imagePart, LlmClient, type ChatMessage } from '@oas/llm';
import type { UiNode } from '@oas/flow-graph';
import { bottomRowItems, detectTabBar, type TabItem } from './tabbar.js';

/**
 * Vision analysis of an app screen. DeepSeek (text) can't *see* the UI — it
 * reasons over the uiTree blind, which is why geometric tab-bar detection is
 * brittle. A vision model (Qwen-VL by default) looks at the actual screenshot.
 *
 * We use the VLM for SEMANTICS (is this e-commerce? is there a tab bar? what
 * are the tabs, left-to-right?) and the uiTree for the OPERABLE selectors —
 * VLM labels are aligned onto the geometry-detected tab elements so taps stay
 * replayable.
 */

export interface EntryAnalysis {
  /** 'e-commerce' | 'social' | 'media' | 'tool' | 'other' … (free-form). */
  appType: string;
  hasTabBar: boolean;
  /** Tab labels, left-to-right, exactly as shown. */
  tabs: string[];
  reasoning?: string;
}

export interface StuckAnalysis {
  /** A short instruction for what to do next, in plain words. */
  suggestion: string;
  /** Visible text of the element to interact with, if identifiable. */
  targetText?: string;
}

export interface VlmAnalyzers {
  /** First-screen analysis → semantics + tab items resolved to uiTree selectors. */
  analyzeEntry: (screenshotPath: string, tree: UiNode) => Promise<{ analysis: EntryAnalysis; tabs?: TabItem[] }>;
  /** When the text policy is stuck, ask the VLM what to do on this screen. */
  analyzeStuck: (screenshotPath: string, context: string) => Promise<StuckAnalysis>;
  /** Extract design tokens (colors, corner radius) from a screenshot. */
  analyzeTheme: (screenshotPath: string) => Promise<ThemeTokens>;
}

/** Design tokens (structure mirrors app-spec ThemeTokens; colors are hex strings). */
export interface ThemeTokens {
  colors?: Record<string, string>;
  radii?: Record<string, number>;
  spacing?: Record<string, number>;
}

const THEME_PROMPT = `Look at this mobile app screenshot and extract its design tokens. Reply with JSON ONLY:
{"colors":{"bg":"#hex","panel":"#hex","text":"#hex","muted":"#hex","accent":"#hex","onAccent":"#hex","border":"#hex"},"radii":{"md":12}}
- bg: the dominant page background. panel/surface: cards. text: primary text. muted: secondary text. accent: the brand/primary action color (buttons, highlights). onAccent: text on the accent color. border: hairline/divider color.
- radii.md: typical card/button corner radius in px (estimate).
- Use 6-digit hex (#RRGGBB). Estimate from what you see; omit a key only if truly indeterminable.`;

const ENTRY_PROMPT = `You are looking at the FIRST screen of a mobile app. Reply with a JSON object ONLY (no prose), shape:
{"appType": "...", "hasTabBar": true, "tabs": ["Home","Explore","Cart","Me"], "reasoning": "..."}
Rules:
- appType: one of e-commerce, social, media, finance, travel, tool, other.
- hasTabBar: true only if there is a BOTTOM tab bar — a row of 2-5 icon+label items pinned at the very bottom that switches top-level sections.
- tabs: the bottom-tab labels in LEFT-TO-RIGHT order, exactly as written. [] if no tab bar.`;

/**
 * Build the VLM analyzers from env (OAS_VLM_*). Returns undefined when no
 * vision endpoint is configured, so callers fall back to heuristics.
 */
export function makeVlmAnalyzers(cfg: Partial<{ apiKey: string; baseUrl: string; model: string; fetchImpl: typeof fetch }> = {}): VlmAnalyzers | undefined {
  const client = new LlmClient({
    apiKey: cfg.apiKey ?? process.env.OAS_VLM_API_KEY,
    baseUrl: cfg.baseUrl ?? process.env.OAS_VLM_BASE_URL,
    model: cfg.model ?? process.env.OAS_VLM_MODEL,
    fetchImpl: cfg.fetchImpl,
  });
  if (!client.configured) return undefined;

  const ask = async (screenshotPath: string, prompt: string): Promise<string> => {
    const b64 = (await readFile(screenshotPath)).toString('base64');
    const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }, imagePart(b64)] }];
    // Not using JSON response_format — not every vision endpoint supports it; we parse leniently.
    return client.chat(messages, { temperature: 0, maxTokens: 800 });
  };

  return {
    analyzeEntry: async (screenshotPath, tree) => {
      const analysis = parseJson<EntryAnalysis>(await ask(screenshotPath, ENTRY_PROMPT));
      const tabs = analysis.hasTabBar && analysis.tabs?.length ? resolveTabs(tree, analysis.tabs) : undefined;
      return { analysis, tabs };
    },
    analyzeStuck: async (screenshotPath, context) => {
      const prompt = `You are exploring a mobile app and seem stuck. Context: ${context}
Look at the screenshot and reply with JSON ONLY: {"suggestion": "...", "targetText": "..."}
- suggestion: the single best next action in plain words (e.g. "tap the Skip button top-right", "dismiss the popup").
- targetText: the visible text of the element to tap, if any.`;
      return parseJson<StuckAnalysis>(await ask(screenshotPath, prompt));
    },
    analyzeTheme: async (screenshotPath) => {
      const raw = parseJson<ThemeTokens>(await ask(screenshotPath, THEME_PROMPT));
      // Keep only valid hex colors and positive radii — never let a bad value poison codegen.
      const colors = Object.fromEntries(
        Object.entries(raw.colors ?? {}).filter(([, v]) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)),
      );
      const radii = Object.fromEntries(
        Object.entries(raw.radii ?? {}).filter(([, v]) => typeof v === 'number' && v >= 0 && v <= 64),
      );
      return {
        ...(Object.keys(colors).length ? { colors } : {}),
        ...(Object.keys(radii).length ? { radii } : {}),
      };
    },
  };
}

/**
 * Align VLM tab labels (semantics) onto operable uiTree selectors. The VLM
 * knows how many tabs there are and their order; we want a selector for EACH
 * one. Prefer geometry detection when it found at least as many tabs as the
 * VLM saw; otherwise fall back to the bottom-most clickable row so we don't
 * drop a tab (e.g. iHerb's Me / myaccount_dest) the strict detector missed.
 */
function resolveTabs(tree: UiNode, labels: string[]): TabItem[] | undefined {
  const geom = detectTabBar(tree);
  const source = geom && geom.length >= labels.length ? geom : bottomRowItems(tree);
  if (source.length < 2) return geom && geom.length >= 2 ? geom : undefined;
  const n = Math.min(labels.length, source.length);
  return source.slice(0, n).map((t, i) => ({ ...t, label: labels[i]?.trim() || t.label }));
}

/** Lenient JSON extraction — strips code fences and grabs the first {...} block. */
function parseJson<T>(raw: string): T {
  const fenced = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(fenced) as T;
  } catch {
    const m = fenced.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error(`VLM returned non-JSON: ${fenced.slice(0, 200)}…`);
  }
}
