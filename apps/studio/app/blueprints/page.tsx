'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GATEWAY_URL } from '../../lib/gateway';

interface BlueprintSummary {
  id: string;
  appName: string;
  screens: number;
  runId?: string;
  updatedAt: string;
}

export default function BlueprintsPage() {
  const [blueprints, setBlueprints] = useState<BlueprintSummary[]>([]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setBlueprints(await (await fetch(`${GATEWAY_URL}/api/blueprints`)).json());
      } catch {
        setOffline(true);
      }
    })();
  }, []);

  return (
    <main className="page">
      <h2 style={{ fontWeight: 650 }}>Blueprints</h2>
      {offline && <p className="error-box">Gateway unreachable at {GATEWAY_URL}.</p>}
      <table className="runs">
        <thead>
          <tr>
            <th>App</th>
            <th>Screens</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {blueprints.map((b) => (
            <tr key={b.id}>
              <td>
                <Link href={`/blueprints/${b.id}`}>{b.appName}</Link>
              </td>
              <td>{b.screens}</td>
              <td>{new Date(b.updatedAt).toLocaleTimeString()}</td>
            </tr>
          ))}
          {blueprints.length === 0 && !offline && (
            <tr>
              <td colSpan={3} style={{ color: 'var(--muted)' }}>
                No blueprints yet — open a finished run and hit “Promote to Blueprint”.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
