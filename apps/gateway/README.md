# @oas/gateway

API server: auth, projects, and long-running jobs (clone runs, component generation, builds) with WebSocket progress streaming.

- **Stack**: Node.js (Hono) · in-memory run store (Postgres + BullMQ arrive in M2)
- **Owns**: CloneRun lifecycle · WebSocket event streaming · interim live graph viewer at `/`

```bash
pnpm --filter @oas/gateway build && pnpm --filter @oas/gateway start
# open http://localhost:4400 and click "Run fake demo" — no emulator required
```

API: `POST /api/runs` `{url | appId, driver: adb|fake, maxActions?}` · `GET /api/runs[/:id[/ifg]]` ·
`GET /api/runs/:id/flows/:flowId/replay` (Maestro YAML) · WS `/api/runs/:id/events` (buffered replay + live tail)
