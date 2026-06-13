'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GATEWAY_URL, type RunSummary } from '../lib/gateway';

export default function HomePage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [target, setTarget] = useState('');
  const [driver, setDriver] = useState<'fake' | 'adb'>('adb');
  const [brain, setBrain] = useState<'llm' | 'heuristic'>('llm');
  const [budget, setBudget] = useState(120);
  const [error, setError] = useState<string>();
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/api/runs`);
      setRuns(await res.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const body: Record<string, unknown> = { driver, brain, maxActions: budget };
    // fake → backend uses the demo shop. adb → url, or package, or (empty) the
    // app currently in the emulator's foreground.
    if (driver !== 'fake') {
      const t = target.trim();
      if (/^https?:\/\//.test(t)) body.url = t;
      else if (t) body.appId = t;
    }
    const res = await fetch(`${GATEWAY_URL}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { runId?: string; error?: string };
    if (!res.ok || !data.runId) {
      setError(data.error ?? `HTTP ${res.status}`);
      return;
    }
    router.push(`/runs/${data.runId}`);
  }

  return (
    <main className="page">
      <form className="run-form" onSubmit={createRun}>
        <select value={driver} onChange={(e) => setDriver(e.target.value as 'fake' | 'adb')} title="Device backend">
          <option value="adb">adb (emulator)</option>
          <option value="fake">fake device (demo)</option>
        </select>
        {driver !== 'fake' && (
          <input
            type="text"
            placeholder="App Store / Play URL or package (empty = current app on emulator)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        )}
        <select value={brain} onChange={(e) => setBrain(e.target.value as 'llm' | 'heuristic')} title="Exploration brain">
          <option value="llm">AI brain (LLM)</option>
          <option value="heuristic">heuristic (fast)</option>
        </select>
        <label className="budget-field" title="Max actions — higher explores deeper but takes longer">
          budget
          <input
            type="number"
            min={10}
            max={1000}
            step={10}
            value={budget}
            onChange={(e) => setBudget(Math.max(10, Number(e.target.value) || 10))}
          />
        </label>
        <button type="submit" className="primary">
          ▶ Clone
        </button>
      </form>
      {error && <p className="error-box">{error}</p>}
      {offline && (
        <p className="error-box">
          Gateway unreachable at {GATEWAY_URL} — start it with <code>pnpm --filter @oas/gateway start</code>
        </p>
      )}

      <table className="runs">
        <thead>
          <tr>
            <th>App</th>
            <th>Status</th>
            <th>Screens</th>
            <th>Transitions</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/runs/${r.id}`}>{r.appId}</Link>
              </td>
              <td>
                <span className="status" data-s={r.status}>
                  {r.status}
                </span>
              </td>
              <td>{r.coverage?.nodes ?? '…'}</td>
              <td>{r.coverage?.edges ?? '…'}</td>
              <td>{new Date(r.createdAt).toLocaleTimeString()}</td>
            </tr>
          ))}
          {runs.length === 0 && !offline && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--muted)' }}>
                No runs yet — paste a store link above, or just hit ▶ Clone for the fake demo.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
