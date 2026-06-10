# @oas/gateway

API server: auth, projects, and long-running jobs (clone runs, component generation, builds) with WebSocket progress streaming.

- **Stack**: Node.js (Hono) · Postgres · BullMQ (Redis)
- **Owns**: CloneRun lifecycle · job queue · agent runtime hosting
- Design: [docs/architecture.md](../../docs/architecture.md)

Status: not yet scaffolded — see [Roadmap M1](../../docs/roadmap.md).
