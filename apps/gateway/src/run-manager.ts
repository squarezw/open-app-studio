import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Orchestrator, type CloneRunOptions } from '@oas/clone-agents';
import type { DeviceDriver } from '@oas/device-bridge';
import type { GraphEvent, InteractionFlowGraph } from '@oas/flow-graph';

export type RunStatus = 'running' | 'paused' | 'done' | 'error';

export interface RunEvent {
  seq: number;
  kind: 'graph' | 'log' | 'status';
  data: unknown;
}

/** Everything needed to RE-RUN a clone with the same parameters. */
export interface RunSpec {
  appId: string;
  appName?: string;
  url?: string;
  storeUrl?: string;
  driver: 'adb' | 'fake' | 'appium';
  brain: 'llm' | 'heuristic';
  serial?: string;
  maxActions?: number;
  stallThreshold?: number;
}

export interface RunRecord {
  id: string;
  appId: string;
  status: RunStatus;
  createdAt: string;
  events: RunEvent[];
  ifg?: InteractionFlowGraph;
  error?: string;
  spec?: RunSpec;
}

type Listener = (event: RunEvent) => void;

/**
 * Run store with on-disk persistence. Each run writes `<runsDir>/<id>/`:
 * run.json (spec + status + coverage), report.md, screens/, ifg.json. On
 * startup we reload those so finished runs survive a gateway restart and can be
 * re-run.
 */
export class RunManager {
  private runs = new Map<string, RunRecord & { listeners: Set<Listener>; orchestrator?: Orchestrator }>();

  constructor(private runsDir?: string) {}

  /** Reload finished runs from disk (call once at startup). */
  loadFromDisk(): number {
    if (!this.runsDir || !existsSync(this.runsDir)) return 0;
    let loaded = 0;
    for (const id of readdirSync(this.runsDir)) {
      const dir = join(this.runsDir, id);
      const metaPath = join(dir, 'run.json');
      if (this.runs.has(id) || !existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<RunRecord> & { spec?: RunSpec; coverage?: unknown };
        const ifgPath = join(dir, 'ifg.json');
        const ifg = existsSync(ifgPath) ? (JSON.parse(readFileSync(ifgPath, 'utf8')) as InteractionFlowGraph) : undefined;
        this.runs.set(id, {
          id,
          appId: meta.appId ?? meta.spec?.appId ?? id,
          // only 'done' survives a restart; anything in-flight (running/paused) is stale → error
          status: meta.status === 'done' ? 'done' : 'error',
          createdAt: meta.createdAt ?? new Date(0).toISOString(),
          events: [],
          ifg,
          error: meta.status === 'done' ? meta.error : (meta.error ?? 'interrupted by server restart'),
          spec: meta.spec,
          listeners: new Set(),
        });
        loaded += 1;
      } catch {
        /* skip unreadable run dirs */
      }
    }
    return loaded;
  }

  start(spec: RunSpec, driver: DeviceDriver, opts: CloneRunOptions): RunRecord {
    const id = randomUUID();
    const artifactsDir = this.runsDir ? join(this.runsDir, id) : undefined;
    const record: RunRecord & { listeners: Set<Listener>; orchestrator?: Orchestrator } = {
      id,
      appId: spec.appId,
      status: 'running',
      createdAt: new Date().toISOString(),
      events: [],
      spec,
      listeners: new Set(),
    };
    this.runs.set(record.id, record);
    if (artifactsDir) void this.persist(record, artifactsDir);

    const orchestrator = new Orchestrator(driver, { ...opts, appId: spec.appId, outDir: artifactsDir ?? opts.outDir });
    record.orchestrator = orchestrator;
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
  addCompleted(ifg: InteractionFlowGraph, spec?: RunSpec): RunRecord {
    const record: RunRecord & { listeners: Set<Listener> } = {
      id: randomUUID(),
      appId: ifg.meta.appId ?? ifg.meta.appName,
      status: 'done',
      createdAt: new Date().toISOString(),
      events: [],
      ifg,
      spec,
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

  /** Pause a running exploration. Returns the new status, or null if not running. */
  pause(id: string): RunStatus | null {
    const record = this.runs.get(id);
    if (!record || record.status !== 'running' || !record.orchestrator) return null;
    record.orchestrator.pause();
    record.status = 'paused';
    this.push(record, 'status', { status: 'paused' });
    return 'paused';
  }

  /** Resume a paused exploration. */
  resume(id: string): RunStatus | null {
    const record = this.runs.get(id);
    if (!record || record.status !== 'paused' || !record.orchestrator) return null;
    record.orchestrator.resume();
    record.status = 'running';
    this.push(record, 'status', { status: 'running' });
    return 'running';
  }

  /** Stop a running/paused exploration; it ends with the graph gathered so far. */
  stop(id: string): boolean {
    const record = this.runs.get(id);
    if (!record || (record.status !== 'running' && record.status !== 'paused') || !record.orchestrator) return false;
    record.orchestrator.stop(); // loop breaks → run() resolves → status becomes 'done'
    return true;
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

  /** Write run.json + report.md + ifg.json for a run (best-effort). */
  private async persist(record: RunRecord, dir: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'run.json'),
        JSON.stringify(
          {
            id: record.id,
            appId: record.appId,
            status: record.status,
            createdAt: record.createdAt,
            error: record.error,
            spec: record.spec,
            coverage: record.ifg?.meta.coverage,
          },
          null,
          2,
        ),
      );
      if (record.ifg) await writeFile(join(dir, 'ifg.json'), JSON.stringify(record.ifg, null, 2));
      if (record.status !== 'running') await writeFile(join(dir, 'report.md'), this.renderReport(record));
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
