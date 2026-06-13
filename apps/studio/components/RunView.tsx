'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionEdge, Flow, ScreenNode } from '@oas/flow-graph';
import {
  controlRun,
  fetchLayout,
  GATEWAY_URL,
  gatewayWsUrl,
  saveLayout,
  type NodePositions,
  type RunSummary,
} from '../lib/gateway';
import type { PartialIfg } from '../lib/ifg-to-flow';
import FlowCanvas from './FlowCanvas';

interface GraphEventData {
  type: 'node' | 'edge';
  node?: ScreenNode;
  edge?: ActionEdge;
  isNew?: boolean;
}

export default function RunView({ id }: { id: string }) {
  const router = useRouter();
  const [run, setRun] = useState<RunSummary>();
  const [promoting, setPromoting] = useState(false);
  const [graph, setGraph] = useState<PartialIfg>({ nodes: [], edges: [] });
  const [selectedFlow, setSelectedFlow] = useState<string>();
  const [savedPositions, setSavedPositions] = useState<NodePositions>();
  const [error, setError] = useState<string>();
  const nodesRef = useRef(new Map<string, ScreenNode>());
  const edgesRef = useRef(new Map<string, ActionEdge>());

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | undefined;

    async function fetchFullIfg() {
      const res = await fetch(`${GATEWAY_URL}/api/runs/${id}/ifg`);
      if (!res.ok) return;
      const ifg = (await res.json()) as PartialIfg;
      if (!cancelled) setGraph(ifg);
    }

    (async () => {
      let info: RunSummary;
      try {
        const res = await fetch(`${GATEWAY_URL}/api/runs/${id}`);
        if (!res.ok) throw new Error(`run not found (HTTP ${res.status})`);
        info = (await res.json()) as RunSummary;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (cancelled) return;
      setRun(info);
      void fetchLayout(id).then((p) => {
        if (!cancelled) setSavedPositions(p);
      });

      if (info.status !== 'running') {
        await fetchFullIfg();
        return;
      }

      // Live run: the WS replays buffered events, then tails new ones.
      ws = new WebSocket(gatewayWsUrl(`/api/runs/${id}/events`));
      ws.onmessage = (m) => {
        const event = JSON.parse(m.data as string) as { kind: string; data: unknown };
        if (event.kind === 'graph') {
          const g = event.data as GraphEventData;
          if (g.type === 'node' && g.node) nodesRef.current.set(g.node.id, g.node);
          if (g.type === 'edge' && g.edge) edgesRef.current.set(g.edge.id, g.edge);
          setGraph({ nodes: [...nodesRef.current.values()], edges: [...edgesRef.current.values()] });
        } else if (event.kind === 'status') {
          const { status, error: runError } = event.data as { status: RunSummary['status']; error?: string };
          setRun((prev) => (prev ? { ...prev, status, error: runError } : prev));
          // The final IFG additionally carries annotations (roles) and flows.
          void fetchFullIfg();
        }
      };
    })();

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [id]);

  const highlight = useMemo(() => {
    const flow = graph.flows?.find((f: Flow) => f.id === selectedFlow);
    return flow ? new Set(flow.edgeIds) : undefined;
  }, [graph.flows, selectedFlow]);

  // Optimistic run controls — the WS 'status' event confirms the new state.
  async function control(action: 'pause' | 'resume' | 'stop') {
    if (action !== 'stop') setRun((p) => (p ? { ...p, status: action === 'pause' ? 'paused' : 'running' } : p));
    try {
      await controlRun(id, action);
    } catch (err) {
      setError(`${action} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function rerun() {
    try {
      const res = await fetch(`${GATEWAY_URL}/api/runs/${id}/rerun`, { method: 'POST' });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/runs/${data.runId}`);
    } catch (err) {
      setError(`re-run failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function promote() {
    setPromoting(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/runs/${id}/blueprint`, { method: 'POST', body: '{}' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id: blueprintId } = (await res.json()) as { id: string };
      router.push(`/blueprints/${blueprintId}`);
    } catch (err) {
      setError(`promote failed: ${err instanceof Error ? err.message : err}`);
      setPromoting(false);
    }
  }

  if (error) return <div className="error-box">{error}</div>;

  return (
    <div className="run-layout">
      <aside className="sidebar">
        <h2>Run</h2>
        <div className="kv">
          <span>app</span>
          <b>{run?.appId ?? '…'}</b>
        </div>
        <div className="kv">
          <span>status</span>
          <span className="status" data-s={run?.status}>
            {run?.status ?? '…'}
          </span>
        </div>
        <div className="kv">
          <span>screens</span>
          <b>{graph.nodes.length}</b>
        </div>
        <div className="kv">
          <span>transitions</span>
          <b>{graph.edges.length}</b>
        </div>
        {(graph.frontier?.length ?? 0) > 0 && (
          <div className="kv">
            <span>frontier</span>
            <b>{graph.frontier!.length}</b>
          </div>
        )}
        {run?.status === 'error' && run.error && <p className="run-error">{run.error}</p>}
        {run?.status === 'done' && graph.nodes.length > 0 && (
          <>
            <p className="run-done">
              ✓ Explored {graph.nodes.length} screens.
              {(graph.frontier?.length ?? 0) > 0 && (
                <>
                  {' '}
                  {graph.frontier!.length} more entry points were seen but not visited (budget reached) — raise the
                  budget on the home page to dig deeper.
                </>
              )}
            </p>
            <button className="primary promote" onClick={promote} disabled={promoting}>
              {promoting ? 'Promoting…' : '🧱 Promote to Blueprint'}
            </button>
          </>
        )}
        {run && run.status !== 'running' && run.rerunnable && (
          <button className="promote" onClick={rerun}>↻ Re-run</button>
        )}
        {run?.status === 'running' && (
          <p className="run-hint">Exploring live — watch the emulator. The graph grows as screens are found.</p>
        )}

        <h2>User flows</h2>
        {(graph.flows ?? []).map((f: Flow) => (
          <button
            key={f.id}
            className="flow-item"
            data-active={selectedFlow === f.id}
            onClick={() => setSelectedFlow(selectedFlow === f.id ? undefined : f.id)}
          >
            {f.name}
            <div className="steps">
              {f.edgeIds.length} step{f.edgeIds.length > 1 ? 's' : ''} ·{' '}
              <a
                href={`${GATEWAY_URL}/api/runs/${id}/flows/${f.id}/replay`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                Maestro YAML
              </a>
            </div>
          </button>
        ))}
        {(graph.flows ?? []).length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            {run?.status === 'running' ? 'Flows appear when the run finishes.' : 'No flows derived.'}
          </p>
        )}
      </aside>
      <div className="canvas-wrap">
        <FlowCanvas
          graph={graph}
          highlight={highlight}
          savedPositions={savedPositions}
          onSaveLayout={(positions) => saveLayout(id, positions)}
          runStatus={run?.status}
          onPause={() => control('pause')}
          onResume={() => control('resume')}
          onStop={() => control('stop')}
        />
      </div>
    </div>
  );
}
