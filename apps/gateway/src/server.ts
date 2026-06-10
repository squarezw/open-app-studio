import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compileBlueprint } from '@oas/app-spec';
import {
  fetchStoreMetadata,
  parseStoreUrl,
  provisionalIfgFromMetadata,
} from '@oas/clone-agents';
import { AdbDriver, FakeDriver, type DeviceDriver } from '@oas/device-bridge';
import { replayScript } from '@oas/flow-graph';
import type { RunManager } from './run-manager.js';
import { VIEWER_HTML } from './viewer.js';

interface CreateRunBody {
  /** App Store / Google Play URL — resolved by the Acquirer. */
  url?: string;
  /** Or a direct Android package name. */
  appId?: string;
  driver?: 'adb' | 'fake';
  serial?: string;
  maxActions?: number;
  stallThreshold?: number;
}

export function createApp(manager: RunManager): Hono {
  const app = new Hono();

  // Studio talks to the gateway cross-origin during development. The gateway
  // can spawn device runs on this machine, so origins are an explicit
  // allowlist — never a wildcard. Override via STUDIO_ORIGIN.
  const allowedOrigins = process.env.STUDIO_ORIGIN?.split(',') ?? [
    'http://localhost:3000',
    'http://localhost:3100',
  ];
  app.use('/api/*', cors({ origin: allowedOrigins }));

  app.get('/', (c) => c.html(VIEWER_HTML));

  app.post('/api/runs', async (c) => {
    let body: CreateRunBody;
    try {
      body = await c.req.json<CreateRunBody>();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    let appId = body.appId;
    let appName: string | undefined;
    let storeUrl: string | undefined;

    if (body.url) {
      let ref;
      try {
        ref = parseStoreUrl(body.url);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
      storeUrl = ref.storeUrl;
      if (ref.platform === 'ios') {
        // No iOS exploration yet — metadata-only fallback (see docs/app-clone-agent.md §2).
        try {
          const meta = await fetchStoreMetadata(ref);
          const record = manager.addCompleted(provisionalIfgFromMetadata(meta));
          return c.json({ runId: record.id, mode: 'inferred' }, 201);
        } catch (err) {
          return c.json({ error: `metadata fetch failed: ${err instanceof Error ? err.message : err}` }, 502);
        }
      }
      appId = ref.appId;
      appName = await fetchStoreMetadata(ref)
        .then((m) => m.name)
        .catch(() => undefined);
    }

    if (!appId) return c.json({ error: 'provide `url` or `appId`' }, 400);

    const driver: DeviceDriver =
      body.driver === 'fake' ? new FakeDriver() : new AdbDriver({ serial: body.serial });
    const record = manager.start(driver, {
      appId,
      appName,
      storeUrl,
      maxActions: body.maxActions,
      stallThreshold: body.stallThreshold,
    });
    return c.json({ runId: record.id, mode: 'explore' }, 201);
  });

  app.get('/api/runs', (c) =>
    c.json(
      manager.list().map((r) => ({
        id: r.id,
        appId: r.appId,
        status: r.status,
        createdAt: r.createdAt,
        coverage: r.ifg?.meta.coverage,
      })),
    ),
  );

  app.get('/api/runs/:id', (c) => {
    const record = manager.get(c.req.param('id'));
    if (!record) return c.json({ error: 'run not found' }, 404);
    return c.json({
      id: record.id,
      appId: record.appId,
      status: record.status,
      createdAt: record.createdAt,
      eventCount: record.events.length,
      error: record.error,
      coverage: record.ifg?.meta.coverage,
    });
  });

  app.get('/api/runs/:id/ifg', (c) => {
    const record = manager.get(c.req.param('id'));
    if (!record) return c.json({ error: 'run not found' }, 404);
    if (!record.ifg) return c.json({ error: `run is ${record.status}, no graph yet` }, 409);
    return c.json(record.ifg);
  });

  app.post('/api/runs/:id/blueprint', async (c) => {
    const record = manager.get(c.req.param('id'));
    if (!record) return c.json({ error: 'run not found' }, 404);
    if (!record.ifg) return c.json({ error: `run is ${record.status}, no graph yet` }, 409);
    const body: { nodeIds?: string[]; appName?: string } = await c.req
      .json<{ nodeIds?: string[]; appName?: string }>()
      .catch(() => ({}));
    try {
      const spec = compileBlueprint(record.ifg, {
        nodeIds: body.nodeIds,
        appName: body.appName,
        runId: record.id,
      });
      return c.json(spec, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
    }
  });

  app.get('/api/runs/:id/flows/:flowId/replay', (c) => {
    const record = manager.get(c.req.param('id'));
    if (!record?.ifg) return c.json({ error: 'run or graph not found' }, 404);
    const flow = record.ifg.flows?.find((f) => f.id === c.req.param('flowId'));
    if (!flow) return c.json({ error: 'flow not found' }, 404);
    return c.text(replayScript(record.ifg, flow), 200, { 'content-type': 'text/yaml' });
  });

  return app;
}
