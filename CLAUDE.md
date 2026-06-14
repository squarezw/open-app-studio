# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Open App Studio (OAS) builds, clones, and ships mobile apps with AI agents. The shipping v1 feature is the **App Clone Engine**: given a running app on a device, a multi-agent crew explores every screen, records each tap/swipe as a trace, and folds it into an **Interaction Flow Graph (IFG)** — a deduplicated, replayable, editable map of the app. The IFG is then compiled into an **App Spec** (buildable definition) and code-generated into a runnable Expo project.

Design docs live in `../OAS-docs/` (architecture, app-clone-agent, interaction-flow-graph, component-system, build-and-publish, roadmap, **implementation-overview** = current state, **exploration-engine-learnings** = field gotchas). The git repo root is this `open-app-studio/` directory, not its parent.

## Commands

```bash
pnpm install
pnpm dev          # scripts/dev.sh: frees ports, turbo build, then gateway :4400 + studio :3100; Ctrl+C stops both
pnpm build        # turbo run build (respects ^build dependency order; cached)
pnpm test         # turbo run test — all vitest suites (~140 tests)
```

- **Studio hot-reloads** (frontend edits need no restart). **After backend/package edits, re-run `pnpm dev`** — it rebuilds via turbo then restarts both processes.
- **Run one package's tests**: `pnpm --filter @oas/flow-graph test`
- **Run one test file / pattern**: `pnpm --filter @oas/clone-agents exec vitest run policy` (vitest filters by file path substring).
- **Override ports**: `GATEWAY_PORT=… STUDIO_PORT=… pnpm dev`.
- Node ≥ 22, pnpm 9.15. CI (`.github/workflows`) runs `pnpm build` then `pnpm test` on push/PR to `dev` and `main`.

## Architecture

Monorepo: `apps/*` (gateway, studio) + `packages/*` (libraries), pnpm workspace + Turborepo, TypeScript strict, ESM (`"type": "module"`, NodeNext resolution). Packages build to `dist/` via `tsc`; consume each other as `@oas/<name>` (`workspace:*`).

**The pipeline** (one direction, IFG is the hub):
```
device → Explorer (observe→decide→act→record) → IFG → Annotator (screen roles + flows)
       → Blueprint Compiler → App Spec → Codegen → Expo project + Maestro e2e
```

**Packages** (see `../OAS-docs/implementation-overview.md` for the authoritative table):
- `@oas/flow-graph` — the IFG model (ScreenNode / ActionEdge / Flow). `GraphBuilder` dedups screens by a **content-invariant structural fingerprint**; `pathTo`/`replayScript` export Maestro YAML. This is the central data structure everything else reads or writes.
- `@oas/device-bridge` — `DeviceDriver` abstraction with `AdbDriver` (real adb, emulator auto-boot), `AppiumDriver` (UiAutomator2), `FakeDriver` (in-memory demo apps, no emulator). Uniform capability set: `screenshot/uiTree/tap/swipe/type/back/launch/deepLink`.
- `@oas/clone-agents` — the exploration engine. `Orchestrator` drives a `CloneRun` (budget/stall/pause/stop); explorers (`heuristic-explorer`, `llm-explorer`) run the observe-decide-act loop; `policy` scores interactables; `tabbar` + `entry-analyzer` (VLM) detect app structure; `annotator`/`llm-annotator` tag screen roles. CLIs: `cli.ts`, `bench-cli.ts`.
- `@oas/llm` — provider-agnostic OpenAI-compatible client (plain fetch). Text + multimodal.
- `@oas/app-spec` — App Spec DSL + Blueprint Compiler (IFG → buildable blueprint).
- `@oas/component-registry` — built-in UI-block manifests.
- `@oas/component-gen` — LLM-generated custom RN components (sandbox + repair loop).
- `@oas/codegen` — App Spec → runnable Expo (expo-router) project + Maestro e2e.
- `apps/gateway` — Hono REST + WebSocket server. `RunManager` owns run lifecycle and persistence; clone runs stream progress to Studio over WS so the UI is a *live show*. Run artifacts persist to `runs/<runId>/` (`run.json`, `ifg.json`, `report.md`, `screens/`, `trees/`) and reload on restart.
- `apps/studio` — Next.js 15 (App Router) + React Flow (`@xyflow/react`). Renders the IFG as a graph (BFS-layered layout), path focus/highlight, click-region overlays on screenshots, drag positions persisted to `layout.json`.

## Conventions and gotchas

- **The IFG is observed behavior; the App Spec is the buildable definition.** Keep them distinct — the Blueprint Compiler bridges them, and cloning produces a *draft* the user edits, never a verbatim copy. Don't blur the two models.
- **Screen identity = structural fingerprint**, not screenshot or text. When touching dedup logic, preserve content-invariance (two instances of the same screen with different data must collapse to one node).
- **Tabs are top-level entries**, deliberately excluded from free exploration on every screen (exact-id set + `*_dest`/`nav_` shape guard); entered only by relaunching to the entry. This keeps the IFG tree-shaped. The exploration loop is hardened against real-device quirks (soft-keyboard, bounded scroll, network-loaded pickers, relaunch-on-trap) — read `../OAS-docs/exploration-engine-learnings.md` before changing explorer/policy code.
- **Vision vs text models split**: DeepSeek (`OAS_LLM_*`) makes text decisions and generates components; Qwen-VL (`OAS_VLM_*`) reads launch screenshots to classify app type and find the tab bar. Both are any OpenAI-compatible endpoint. Keys go in the gitignored `.env` (see `.env.example`); the gateway loads it via `--env-file-if-exists`.
- **adb runs**: an empty run target makes the gateway `ensureDevice()` auto-boot the emulator (`OAS_ANDROID_AVD`) and read the foreground app; a package name goes through `launch`. The `FakeDriver` path (empty input in the UI) needs no emulator — use it for demos and quick checks.
- New libraries must compile to `dist/` and be added as a `workspace:*` dependency to consumers; turbo's `^build` ordering handles the rest.
