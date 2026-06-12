'use client';

import { useState } from 'react';
import type { ComponentManifest } from '@oas/component-registry';
import { GATEWAY_URL } from '../lib/gateway';

export interface CustomComponent {
  manifest: ComponentManifest;
  tsx: string;
  attempts: number;
}

/**
 * ✨ AI component generation: prompt → gateway sandbox pipeline → review the
 * generated code → add to the current screen. Accepted components join the
 * project registry (palette "Custom" section) automatically.
 */
export default function AiPanel({
  onGenerated,
  onInsert,
}: {
  onGenerated: () => void;
  onInsert: (component: CustomComponent) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CustomComponent>();
  const [error, setError] = useState<string>();
  const [showCode, setShowCode] = useState(false);

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/components/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as CustomComponent & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-panel">
      <h2>✨ AI component</h2>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe a component… e.g. a circular progress ring with a percentage label"
        rows={3}
      />
      <button className="primary" onClick={generate} disabled={busy || !prompt.trim()}>
        {busy ? 'Generating… (sandbox loop)' : 'Generate'}
      </button>
      {error && <p className="ai-error">{error}</p>}
      {result && (
        <div className="ai-result">
          <div className="ai-result-head">
            <b>{result.manifest.name}</b>
            <span className="inspector-ref">{result.manifest.ref}</span>
            <span className="pv-label">passed sandbox in {result.attempts} attempt{result.attempts > 1 ? 's' : ''}</span>
          </div>
          <div className="ai-actions">
            <button onClick={() => setShowCode(!showCode)}>{showCode ? 'Hide code' : 'Review code'}</button>
            <button className="primary" onClick={() => onInsert(result)}>＋ Add to screen</button>
          </div>
          {showCode && <pre className="ai-code">{result.tsx}</pre>}
        </div>
      )}
    </div>
  );
}
