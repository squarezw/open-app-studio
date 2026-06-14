import { EventEmitter } from 'node:events';
import type { DeviceDriver } from '@oas/device-bridge';
import type { GraphEvent, InteractionFlowGraph, Platform } from '@oas/flow-graph';
import { annotate, deriveFlows, deriveLeafFlows } from './annotator.js';
import { explore, type Decider } from './heuristic-explorer.js';
import type { VlmAnalyzers } from './entry-analyzer.js';

/**
 * Owns one clone run end-to-end: exploration (with budget + stall stop
 * conditions), then the annotation pass and flow derivation.
 *
 * Events (for WebSocket streaming / logging):
 *   'graph'  (GraphEvent)            — node/edge added or revisited
 *   'log'    (string)                — human-readable progress
 *   'done'   (InteractionFlowGraph)  — final annotated graph
 *   'error'  (Error)
 *
 * M1 runs a single Explorer; the multi-device frontier-sharding version
 * changes scheduling here, not the events contract.
 */
export interface CloneRunOptions {
  appId: string;
  appName?: string;
  storeUrl?: string;
  platform?: Platform;
  /** Hard budget on executed actions. */
  maxActions?: number;
  /** Stop when this many actions pass without discovering a new screen. */
  stallThreshold?: number;
  outDir?: string;
  /** Decision strategy (e.g. the LLM brain); defaults to the heuristic policy. */
  decide?: Decider;
  /** High-level goal for a goal-directed decider. */
  goal?: string;
  /** Vision analyzers (entry-screen analysis); omit to use heuristics only. */
  vlm?: VlmAnalyzers;
  /** Optional LLM role refinement, applied after the keyword annotator. */
  annotate?: (ifg: InteractionFlowGraph) => Promise<void>;
}

export class Orchestrator extends EventEmitter {
  private stopped = false;
  private paused = false;

  constructor(
    private driver: DeviceDriver,
    private opts: CloneRunOptions,
  ) {
    super();
  }

  /** Cooperative abort: takes effect at the next loop iteration. */
  stop(): void {
    this.stopped = true;
    this.paused = false; // unblock a paused loop so it can observe the stop
  }

  /** Pause exploration at the next loop iteration (the loop blocks until resume/stop). */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async run(): Promise<InteractionFlowGraph> {
    const stallThreshold = this.opts.stallThreshold ?? 50;
    let lastDiscoveryAction = 0;
    let latestActions = 0;

    try {
      const ifg = await explore(this.driver, {
        appId: this.opts.appId,
        appName: this.opts.appName,
        platform: this.opts.platform,
        maxActions: this.opts.maxActions,
        outDir: this.opts.outDir,
        decide: this.opts.decide,
        goal: this.opts.goal,
        vlm: this.opts.vlm,
        log: (m) => this.emit('log', m),
        onEvent: (event: GraphEvent) => {
          if (event.type === 'node' && event.isNew) lastDiscoveryAction = latestActions;
          this.emit('graph', event);
        },
        shouldStop: (counts) => {
          latestActions = counts.actions;
          if (this.stopped) return true;
          if (counts.actions - lastDiscoveryAction >= stallThreshold) {
            this.emit('log', `stalled: ${stallThreshold} actions without a new screen`);
            return true;
          }
          return false;
        },
        waitWhilePaused: async () => {
          while (this.paused && !this.stopped) await new Promise((r) => setTimeout(r, 200));
        },
      });

      if (this.opts.storeUrl) ifg.meta.storeUrl = this.opts.storeUrl;
      annotate(ifg); // keyword baseline
      if (this.opts.annotate) await this.opts.annotate(ifg); // LLM semantic refinement
      // Role-based flows + every DFS dead-end path, deduped by edge sequence.
      const combined = [...(ifg.flows ?? []), ...deriveFlows(ifg), ...deriveLeafFlows(ifg)];
      const seen = new Set<string>();
      ifg.flows = combined.filter((f) => {
        const key = f.edgeIds.join(',');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      this.emit('log', `done: ${ifg.nodes.length} screens, ${ifg.edges.length} transitions, ${ifg.flows.length} flows`);
      this.emit('done', ifg);
      return ifg;
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
}
