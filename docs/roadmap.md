# Roadmap

Milestones are scoped so each one ends with something demoable.

## M0 — Skeleton & spike (validate the riskiest assumption)

The riskiest assumption is **Stage 1 exploration**: can an agent reliably drive an arbitrary app on an emulator and produce a clean state graph?

- [x] Monorepo scaffolding (pnpm + Turborepo), CI, schemas checked in
- [x] `device-bridge`: Android driver over adb (`screenshot/uiTree/tap/type/swipe/back/deepLink`); Maestro driver lands in M1
- [x] Single-Explorer spike: heuristic (LLM-free) explorer with integration test on a simulated 5-screen app
- [x] `flow-graph`: structural fingerprinting + graph builder (dedup, edge canonicalization, frontier); IFG validates against the JSON Schema
- **Demo**: `oas-spike --app <package>` explores an installed app on a running emulator and writes `ifg.json` + screenshots. ✅ implemented — run against a real emulator pending.

## M1 — Clone vertical slice (the headline feature)

- [x] Orchestrator: stop conditions (budget / discovery-stall / cooperative abort), live graph events; Cartographer duties live in GraphBuilder (single-Explorer; multi-device frontier sharding moves to M4)
- [x] Acquirer: store-URL parsing (App Store / Play), metadata fetch (iTunes lookup + Play scrape), metadata-only fallback → provisional `inferred` IFG
- [x] Gateway: `POST /api/runs` + WebSocket event stream (buffered replay + live tail), flow replay-script endpoint
- [x] Studio: shell + **live Flow Graph viewer** (Next.js + React Flow): role-colored screen nodes, live WS updates, flow highlighting, Maestro YAML export; screenshot thumbnails render for http-hosted evidence (store metadata), local-file evidence serving lands with M2 persistence
- [x] Annotator v0 (rule-based): screen roles + named flows; replay via generated Maestro YAML (`flows/*.yaml`); LLM Annotator lands with M3 semantics work
- **Demo**: paste a Play Store URL → watch the graph grow live → click "Purchase" flow → replay it on the emulator. *Today (no emulator needed):* `pnpm --filter @oas/gateway start` → open `http://localhost:4400` → "Run fake demo".

## M2 — From graph to app (close the loop)

- [x] `app-spec` DSL + schema; Blueprint Compiler (IFG subgraph → spec draft): role → default blocks, patterns → registry lookup, edges → nav buttons, launch fan-out → tabs, observed form fields → data models; `POST /api/runs/:id/blueprint`
- [x] `component-registry`: 31 built-in block manifests with pattern tags + lookups (RN implementations land with codegen)
- [x] Studio canvas: blueprint store (gateway CRUD) + "Promote to Blueprint" from runs + editor — phone-frame preview of all 31 blocks, click-to-add palette, props inspector (typed inputs from manifests), undo/redo, save/export. Drag-reorder polish and the AI sidebar (patch-review) move to M3 with the LLM integration.
- [x] `codegen`: spec → runnable Expo project (expo-router, 31 block implementations, demo data seeds, dark theme tokens); IFG flows re-targeted as Maestro E2E tests against the generated UI; `oas-codegen` CLI. Verified: generated FakeShop clone passes `tsc --noEmit` strict against real Expo SDK 52.
- **Demo**: clone an app → promote its main flow to a blueprint → edit on canvas → run the generated Expo app on the emulator → its E2E flow passes. *Today:* `oas-spike --app x --driver fake --out /tmp/run && oas-codegen --ifg /tmp/run/ifg.json --out /tmp/app && cd /tmp/app && npm i && npx expo start`.

## M3 — AI component generation & polish

- [ ] Component Generator agent + sandbox (typecheck/lint/render) loop
- [ ] Screenshot-region → component generation (visual matching without asset copying)
- [ ] Theme token extraction from IFG screenshots
- [ ] IFG coverage report UI; resume/extend a previous clone run
- **Demo**: "make this card look like that one" — point at an IFG node region, get a generated component.

## M4 — Ship

- [ ] BuildProvider interface; EAS Build + Submit integration; fastlane docs for self-hosting
- [ ] Listing Agent (store metadata drafts), screenshot auto-capture, compliance checklist + similarity self-check
- [ ] iOS exploration: device-attached mode (WDA); simulator support where builds allow
- [ ] Release tracking in Studio; OTA updates
- **Demo**: canvas → signed Android build → Play internal-testing track, end to end from Studio.

## Later

- Parallel device farm at scale; cloud-hosted exploration
- IFG diffing across app versions ("what did v2.3 change?")
- Community component registry & theme marketplace
- Web target for codegen
- Multi-app synthesis ("onboarding like X, feed like Y")
