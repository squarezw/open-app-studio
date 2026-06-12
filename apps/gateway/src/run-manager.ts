import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
 * In-memory run store. When `runsDir` is set, each run also persists artifacts
 * to `<runsDir>/<id>/`: per-step screenshots (screens/step_N.png), the decision
 * log with reasoning (report.md), and ifg.json — so a finished run can be
 * inspected from disk without re-watching it.
 */
export class RunManager {
  private runs = new Map<string, RunRecord & { listeners: Set<Listener> }>();

  constructor(private runsDir?: string) {}

  start(driver: DeviceDriver, opts: CloneRunOptions): RunRecord {
    const id = randomUUID();
    const artifactsDir = this.runsDir ? join(this.runsDir, id) : undefined;
    const record: RunRecord & { listeners: Set<Listener> } = {
      id,
      appId: opts.appId,
      status: 'running',
      createdAt: new Date().toISOString(),
      events: [],
      listeners: new Set(),
    };
    this.runs.set(record.id, record);

    const orchestrator = new Orchestrator(driver, { ...opts, outDir: artifactsDir ?? opts.outDir });
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
      })
      .finally(() => {
        if (artifactsDir) void this.persist(record, artifactsDir);
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
    if (this.runsDir) void this.persist(record, join(this.runsDir, record.id));
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

  /** Write report.md + ifg.json for a finished run (best-effort). */
  private async persist(record: RunRecord, dir: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
      if (record.ifg) await writeFile(join(dir, 'ifg.json'), JSON.stringify(record.ifg, null, 2));
      await writeFile(join(dir, 'report.md'), this.renderReport(record));
    } catch {
      /* artifacts are best-effort; never fail a run over them */
    }
  }

  private renderReport(record: RunRecord): string {
    const ifg = record.ifg;
    const cov = ifg?.meta.coverage;
    const log = record.events.filter((e) => e.kind === 'log').map((e) => `- ${String(e.data)}`);
    const lines = [
      `# Clone run — ${record.appId}`,
      '',
      `- status: **${record.status}**${record.error ? ` (${record.error})` : ''}`,
      `- started: ${record.createdAt}`,
      cov ? `- coverage: ${cov.nodes} screens, ${cov.edges} transitions, ${cov.actions} actions, ${cov.frontier} frontier` : '',
      '',
    ];

    if (ifg && ifg.nodes.length > 0) {
      lines.push('## Screens', '');
      ifg.nodes.forEach((n, i) => {
        lines.push(`### ${i + 1}. ${n.title ?? n.id} ${n.role ? `(${n.role})` : ''} — ${n.visits ?? 0} visit(s)`);
        const shot = n.evidence?.find((e) => e.type === 'screenshot' && !/^https?:/.test(e.ref))?.ref;
        if (shot) {
          // ref is an absolute path; link the in-folder copy for markdown viewers
          const rel = shot.split('/screens/').pop();
          if (rel) lines.push('', `![${n.title ?? n.id}](screens/${rel})`);
        }
        lines.push('');
      });
    }

    if (ifg?.flows?.length) {
      lines.push('## User flows', '', ...ifg.flows.map((f) => `- **${f.name}** (${f.edgeIds.length} steps)`), '');
    }

    lines.push('## Decision log', '', ...(log.length ? log : ['- (no log)']));
    return lines.filter((l) => l !== undefined).join('\n') + '\n';
  }
}
