# @oas/clone-agents

The App Clone Engine's agent crew, built on the Claude Agent SDK (TypeScript):

- **Orchestrator** — run budget, frontier scheduling, stop conditions
- **Explorer ×N** — observe → decide → act loop on a device session
- **Cartographer** — trace merging, state dedup, frontier extraction
- **Annotator** — semantic labeling: screen roles, named flows, component patterns

Design: [docs/app-clone-agent.md](../../docs/app-clone-agent.md)

Status: not yet scaffolded — see [Roadmap M0–M1](../../docs/roadmap.md).
