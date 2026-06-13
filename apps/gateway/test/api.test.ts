import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/run-manager.js';
import { createApp } from '../src/server.js';

function makeApp(deps?: Parameters<typeof createApp>[1]) {
  const manager = new RunManager();
  return { app: createApp(manager, deps), manager };
}

async function waitForDone(app: ReturnType<typeof createApp>, runId: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const res = await app.request(`/api/runs/${runId}`);
    const body = (await res.json()) as { status: string; error?: string };
    if (body.status === 'done') return body;
    if (body.status === 'error') throw new Error(`run failed: ${body.error}`);
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for run');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('gateway API', () => {
  it('persists and reloads a canvas layout for a run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oas-layout-'));
    const manager = new RunManager(dir);
    const app = createApp(manager, { runsDir: dir });

    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'com.fakeshop', driver: 'fake', maxActions: 60 }),
    });
    const { runId } = (await create.json()) as { runId: string };
    await waitForDone(app, runId);

    // No layout yet → empty positions.
    expect(((await (await app.request(`/api/runs/${runId}/layout`)).json()) as { positions: unknown }).positions).toEqual(
      {},
    );

    const positions = { n_1: { x: 120, y: 40 }, n_2: { x: 300, y: 200 } };
    const put = await app.request(`/api/runs/${runId}/layout`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()) as { count: number }).toMatchObject({ count: 2 });

    const got = (await (await app.request(`/api/runs/${runId}/layout`)).json()) as { positions: typeof positions };
    expect(got.positions).toEqual(positions);

    // Unknown run can't be saved against.
    expect((await app.request('/api/runs/nope/layout', { method: 'PUT', body: '{}' })).status).toBe(404);
  });

  it('controls a run: pause → resume → stop', async () => {
    const { app } = makeApp();
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'com.tabbed', driver: 'fake', maxActions: 200 }),
    });
    const { runId } = (await create.json()) as { runId: string };

    // Pause shortly after launch (while it's still exploring).
    let paused = false;
    for (let i = 0; i < 40 && !paused; i++) {
      const res = await app.request(`/api/runs/${runId}/pause`, { method: 'POST' });
      if (res.status === 200) {
        expect((await res.json()) as { status: string }).toMatchObject({ status: 'paused' });
        paused = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(paused).toBe(true);

    // While paused, status is 'paused'.
    expect(((await (await app.request(`/api/runs/${runId}`)).json()) as { status: string }).status).toBe('paused');

    // Resume, then stop — the run ends with the graph gathered so far.
    expect((await app.request(`/api/runs/${runId}/resume`, { method: 'POST' })).status).toBe(200);
    expect((await app.request(`/api/runs/${runId}/stop`, { method: 'POST' })).status).toBe(200);
    const final = await waitForDone(app, runId);
    expect(final.status).toBe('done');

    // Controls are 409 once the run is finished.
    expect((await app.request(`/api/runs/${runId}/pause`, { method: 'POST' })).status).toBe(409);
  });

  it('defaults an empty fake run to the demo shop (no url/package needed)', async () => {
    const { app } = makeApp();
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driver: 'fake', maxActions: 60 }), // no url, no appId
    });
    expect(create.status).toBe(201);
    const { runId } = (await create.json()) as { runId: string };
    const info = (await (await app.request(`/api/runs/${runId}`)).json()) as { appId: string };
    expect(info.appId).toBe('com.fakeshop');
  });

  it('creates a fake-driver run and serves the finished IFG', async () => {
    const { app } = makeApp();
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'com.fakeshop', driver: 'fake', maxActions: 60 }),
    });
    expect(create.status).toBe(201);
    const { runId, mode } = (await create.json()) as { runId: string; mode: string };
    expect(mode).toBe('explore');

    await waitForDone(app, runId);

    const ifgRes = await app.request(`/api/runs/${runId}/ifg`);
    expect(ifgRes.status).toBe(200);
    const ifg = (await ifgRes.json()) as {
      nodes: unknown[];
      flows: Array<{ id: string; name: string }>;
    };
    expect(ifg.nodes).toHaveLength(6);
    expect(ifg.flows.map((f) => f.name)).toContain('To Shopping Cart');

    // Replay export for a derived flow
    const flowId = ifg.flows[0]!.id;
    const replay = await app.request(`/api/runs/${runId}/flows/${flowId}/replay`);
    expect(replay.status).toBe(200);
    expect(await replay.text()).toContain('- launchApp');
  });

  it('buffers run events for replay (the WS contract)', async () => {
    const { app, manager } = makeApp();
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'com.fakeshop', driver: 'fake', maxActions: 60 }),
    });
    const { runId } = (await create.json()) as { runId: string };
    await waitForDone(app, runId);

    const record = manager.get(runId)!;
    expect(record.events.length).toBeGreaterThan(10);
    expect(record.events.at(-1)).toMatchObject({ kind: 'status', data: { status: 'done' } });
    // Sequence numbers are gapless — a reconnecting client can resume safely.
    record.events.forEach((e, i) => expect(e.seq).toBe(i));
  });

  it('validates input and 404s unknown runs', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/runs', { method: 'POST', body: '{}' })).status).toBe(400);
    expect(
      (
        await app.request('/api/runs', {
          method: 'POST',
          body: JSON.stringify({ url: 'https://example.com/nope' }),
        })
      ).status,
    ).toBe(400);
    expect((await app.request('/api/runs/nope')).status).toBe(404);
    expect((await app.request('/api/runs/nope/ifg')).status).toBe(404);
  });

  it('compiles a blueprint from a finished run', async () => {
    const { app } = makeApp();
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'com.fakeshop', driver: 'fake', maxActions: 60 }),
    });
    const { runId } = (await create.json()) as { runId: string };
    await waitForDone(app, runId);

    const res = await app.request(`/api/runs/${runId}/blueprint`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(201);
    const blueprint = (await res.json()) as {
      id: string;
      spec: {
        version: string;
        screens: Array<{ role?: string; components: Array<{ ref: string }> }>;
        meta: { generatedFrom: string; sourceRunId: string };
        app: { name: string };
      };
    };
    expect(blueprint.spec.version).toBe('0.1');
    expect(blueprint.spec.screens).toHaveLength(6);
    const cart = blueprint.spec.screens.find((s) => s.role === 'cart')!;
    expect(cart.components.map((c) => c.ref)).toContain('oas/cart-item-list');
    expect(blueprint.spec.meta).toMatchObject({ generatedFrom: 'ifg', sourceRunId: runId });

    // blueprint CRUD: stored, listable, editable
    expect(((await (await app.request('/api/blueprints')).json()) as unknown[]).length).toBe(1);
    const edited = { ...blueprint.spec, app: { ...blueprint.spec.app, name: 'Edited Name' } };
    const put = await app.request(`/api/blueprints/${blueprint.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: edited }),
    });
    expect(put.status).toBe(200);
    const fetched = (await (await app.request(`/api/blueprints/${blueprint.id}`)).json()) as {
      spec: { app: { name: string } };
    };
    expect(fetched.spec.app.name).toBe('Edited Name');

    // rejected inputs
    expect((await app.request('/api/runs/nope/blueprint', { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await app.request('/api/blueprints/nope')).status).toBe(404);
    expect(
      (
        await app.request(`/api/blueprints/${blueprint.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spec: { bogus: true } }),
        })
      ).status,
    ).toBe(400);
  });

  it('generates and stores custom components via the injected pipeline', async () => {
    const manifest = {
      ref: 'custom/stat-ring',
      name: 'Stat Ring',
      description: 'ring',
      patterns: ['chart'],
      props: [{ name: 'value', type: 'number' }],
    };
    const { app } = makeApp({
      generate: async (prompt: string) => ({
        component: { manifest, tsx: `// for: ${prompt}\nexport function StatRing() {}` },
        attempts: 1,
      }),
    });

    const res = await app.request('/api/components/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a stat ring' }),
    });
    expect(res.status).toBe(201);
    const record = (await res.json()) as { manifest: { ref: string }; attempts: number };
    expect(record.manifest.ref).toBe('custom/stat-ring');

    const list = (await (await app.request('/api/components')).json()) as Array<{ manifest: { ref: string } }>;
    expect(list.map((r) => r.manifest.ref)).toEqual(['custom/stat-ring']);

    expect((await app.request('/api/components/generate', { method: 'POST', body: '{}' })).status).toBe(400);
  });

  it('reports 422 when generation fails and 503 when LLM is unconfigured', async () => {
    const failing = makeApp({
      generate: async () => {
        throw new Error('component generation failed after 3 attempts');
      },
    });
    const res = await failing.app.request('/api/components/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(res.status).toBe(422);

    const unconfigured = makeApp({
      generate: async () => {
        throw Object.assign(new Error('LLM not configured'), { status: 503 });
      },
    });
    const res503 = await unconfigured.app.request('/api/components/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(res503.status).toBe(503);
  });

  it('reports the exploration brain and honors brain=heuristic', async () => {
    let deciderBuilt = 0;
    const { app } = makeApp({
      makeDecider: () => {
        deciderBuilt += 1;
        return { brain: 'llm' as const, goal: 'g', decide: (ctx) => ({ act: 'tap' as const, index: 0 }) };
      },
    });

    // default → uses the (fake) LLM brain
    const llmRun = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'com.fakeshop', driver: 'fake', maxActions: 20 }),
    });
    expect((await llmRun.json()).brain).toBe('llm');
    expect(deciderBuilt).toBe(1);

    // explicit heuristic → does not build the LLM decider
    const heuristicRun = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'com.fakeshop', driver: 'fake', brain: 'heuristic', maxActions: 20 }),
    });
    expect((await heuristicRun.json()).brain).toBe('heuristic');
    expect(deciderBuilt).toBe(1); // unchanged
  });

  it('persists runs to disk, reloads them after a restart, and re-runs them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oas-runs-'));
    // "First boot": run to completion → artifacts written to disk.
    const m1 = new RunManager(dir);
    const app1 = createApp(m1, { runsDir: dir });
    const create = await app1.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'com.fakeshop', driver: 'fake', brain: 'heuristic', maxActions: 30 }),
    });
    const { runId } = (await create.json()) as { runId: string };
    await waitForDone(app1, runId);

    // "Restart": a fresh manager over the same dir reloads the finished run.
    const m2 = new RunManager(dir);
    expect(m2.loadFromDisk()).toBeGreaterThanOrEqual(1);
    const app2 = createApp(m2, { runsDir: dir });
    const reloaded = (await (await app2.request(`/api/runs/${runId}`)).json()) as {
      status: string;
      rerunnable: boolean;
    };
    expect(reloaded.status).toBe('done');
    expect(reloaded.rerunnable).toBe(true);
    // its IFG survived too
    expect((await app2.request(`/api/runs/${runId}/ifg`)).status).toBe(200);

    // Re-run it with the same spec → a new run.
    const rerun = await app2.request(`/api/runs/${runId}/rerun`, { method: 'POST' });
    expect(rerun.status).toBe(201);
    const rr = (await rerun.json()) as { runId: string; rerunOf: string };
    expect(rr.runId).not.toBe(runId);
    expect(rr.rerunOf).toBe(runId);
    await waitForDone(app2, rr.runId);
  });

  it('serves the live viewer page', async () => {
    const { app } = makeApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Live Flow Graph');
  });
});
