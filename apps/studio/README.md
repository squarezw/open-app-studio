# @oas/studio

The web app: Flow Graph viewer + run management. The builder canvas (App Spec editor) arrives in M2.

- **Stack**: Next.js (App Router) · React Flow (@xyflow/react)
- **Views**: run list + clone launcher (`/`) · live flow graph with role-colored screen nodes, flow highlighting, and Maestro YAML export (`/runs/:id`)

```bash
pnpm --filter @oas/gateway build && pnpm --filter @oas/gateway start   # gateway on :4400
pnpm --filter @oas/studio dev                                          # studio on :3000
# open http://localhost:3000 and hit "▶ Clone" (empty input = fake demo, no emulator needed)
```

Config: `NEXT_PUBLIC_GATEWAY_URL` (default `http://localhost:4400`).
