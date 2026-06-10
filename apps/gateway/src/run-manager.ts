import { randomUUID } from 'node:crypto';
import { Orchestrator, type CloneRunOptions } from '@oas/clone-agents';
import type { DeviceDriver } from '@oas/device-bridge';
import type { GraphEvent, InteractionFlowGraph } from '@oas/flow-graph';

export type RunStatus = 'running' | 'done' | 'error';

export interface RunEvent {
  seq: number;
  kind: 'graph' | 'log' | 'status';
  data: unknown;
}

export interface RunRecord {
  id: string;
  appId: string;
  status: RunStatus;
  createdAt: string;
  events: RunEvent[];
  ifg?: InteractionFlowGraph;
  error?: string;
}

type Listener = (event: RunEvent) => void;

/**
 * In-memory run store for M1. Postgres-backed persistence replaces the Map in
 * M2; the REST/WS contract (buffered replay + live tail) stays identical.
 */
export class RunManager {
  private runs = new Map<string, RunRecord & { listeners: Set<Listener> }>();

  start(driver: DeviceDriver, opts: CloneRunOptions): RunRecord {
    const record: RunRecord & { listeners: Set<Listener> } = {
      id: randomUUID(),
      appId: opts.appId,
      status: 'running',
      createdAt: new Date().toISOString(),
      events: [],
      listeners: new Set(),
    };
    this.runs.set(record.id, record);

    const orchestrator = new Orchestrator(driver, opts);
    orchestrator.on('graph', (e: GraphEvent) => this.push(record, 'graph', e));
    orchestrator.on('log', (m: string) => this.push(record, 'log', m));

    void orchestrator
      .run()
      .then((ifg) => {
        record.ifg = ifg;
        record.status = 'done';
        this.push(record, 'status', { status: 'done', coverage: ifg.meta.coverage });
      })
      .catch((err: unknown) => {
        record.status = 'error';
        record.error = err instanceof Error ? err.message : String(err);
        this.push(record, 'status', { status: 'error', error: record.error });
      });

    return record;
  }

  /** Registers an already-finished graph (e.g. metadata-only provisional IFG). */
  addCompleted(ifg: InteractionFlowGraph): RunRecord {
    const record: RunRecord & { listeners: Set<Listener> } = {
      id: randomUUID(),
      appId: ifg.meta.appId ?? ifg.meta.appName,
      status: 'done',
      createdAt: new Date().toISOString(),
      events: [],
      ifg,
      listeners: new Set(),
    };
    this.runs.set(record.id, record);
    this.push(record, 'status', { status: 'done', coverage: ifg.meta.coverage });
    return record;
  }

  get(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  list(): RunRecord[] {
    return [...this.runs.values()];
  }

  subscribe(id: string, listener: Listener): () => void {
    const record = this.runs.get(id);
    if (!record) return () => {};
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }

  private push(record: RunRecord & { listeners: Set<Listener> }, kind: RunEvent['kind'], data: unknown): void {
    const event: RunEvent = { seq: record.events.length, kind, data };
    record.events.push(event);
    for (const listener of record.listeners) listener(event);
  }
}
