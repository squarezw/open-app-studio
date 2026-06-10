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

- [ ] Orchestrator + Cartographer agents; frontier scheduling; stop conditions
- [ ] Acquirer: store-URL metadata scrape; APK install path; metadata-only fallback
- [ ] Gateway: CloneRun job + WebSocket progress stream
- [ ] Studio: project shell + **live Flow Graph viewer** (React Flow, screenshot nodes)
- [ ] Annotator: screen roles, named flows; path replay via generated Maestro YAML
- **Demo**: paste a Play Store URL → watch the graph grow live → click "Purchase" flow → replay it on the emulator.

## M2 — From graph to app (close the loop)

- [ ] `app-spec` DSL + schema; Blueprint Compiler (IFG subgraph → spec draft)
- [ ] `component-registry`: ~30 built-in blocks with pattern tags
- [ ] Studio canvas: render spec, drag/drop blocks, props inspector, AI sidebar with patch-review
- [ ] `codegen`: spec → runnable Expo project; IFG flows → E2E tests
- **Demo**: clone an app → promote its main flow to a blueprint → edit on canvas → run the generated Expo app on the emulator → its E2E flow passes.

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
