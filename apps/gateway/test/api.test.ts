import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/run-manager.js';
import { createApp } from '../src/server.js';

function makeApp() {
  const manager = new RunManager();
  return { app: createApp(manager), manager };
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

  it('serves the live viewer page', async () => {
    const { app } = makeApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Live Flow Graph');
  });
});
