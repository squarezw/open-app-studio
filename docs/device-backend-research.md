# Device-control backends & exploration prior art — research + recommendation

Researched & adversarially fact-checked **2026-06-13** (25 claims, all confirmed 3-0).
Version/star facts drift fast — re-check before adopting. Where a fact is vendor- or
author-self-reported (not independently benchmarked), it's flagged.

## 1. Verified status of the tools

| Tool | Latest (as of 2026-06) | License | Stars | Lang / shape | Maintained? | Best fit for OAS |
|---|---|---|---|---|---|---|
| **Maestro** | CLI 2.6.1 (Jun 12 2026), 140 releases | Apache-2.0 | 14.4k | CLI + YAML flows, X-platform (Android/iOS/web, RN/Flutter/hybrid) | ✅ steady cadence | **Replay backend** — deterministic, replayable flows; already in our codegen |
| **Appium** (+ `appium-uiautomator2-driver`, `appium-xcuitest-driver`) | base-driver 10.6.0 (May 31 2026); uia2-driver 848★ | Apache-2.0 | large | Node server, W3C WebDriver, multi-lang clients | ✅ (only newest version supported) | **Rich live backend** — accessibility tree + gestures + selector-rich; iOS via XCUITest |
| **mobile-mcp** (mobile-next) | v0.0.59 (Jun 9 2026), 56 versions | (OSS) | ~5.2k | **TS/npm**, MCP server, iOS+Android unified | ✅ ~weekly | TS-native MCP; a11y-tree-first + screenshot fallback. ⚠ vendor-self-documented; coordinate/bounds-based |
| **Android-MCP** (CursorTouch) | v0.2.0 (May 14 2026) | MIT | ~663 | TS, ADB + Accessibility API, no CV | ⚠ ~1 mo old, no track record (2-1 vote) | Primitives match us (tap/swipe/type-with-clear/press/drag); too young to depend on |
| **replicant-mcp** | active | (OSS) | small | TS, a11y-tree-first | ✅ | Validates "TS for MCP + iOS portability" choice (its DECISIONS.md) |
| **uiautomator2** (openatx) | — | (OSS) | large | **Python** on-device RPC | (no fresh maintenance datapoint surfaced) | Ergonomic Python API, but off-stack (Python sidecar) for our TS monorepo |

Sources: [Maestro](https://github.com/mobile-dev-inc/maestro) · [Appium](https://github.com/appium/appium) · [appium-uiautomator2-driver](https://github.com/appium/appium-uiautomator2-driver) · [mobile-mcp](https://github.com/mobile-next/mobile-mcp) ([npm](https://www.npmjs.com/package/@mobilenext/mobile-mcp)) · [Android-MCP](https://github.com/CursorTouch/Android-MCP) · [replicant-mcp DECISIONS.md](https://glama.ai/mcp/servers/@thecombatwombat/replicant-mcp) · [uiautomator2](https://github.com/openatx/uiautomator2)

**Caveat (important):** no source benchmarks any backend against *OAS's specific* pains
(text replace-vs-append, soft-keyboard detection, long-page scroll, waiting for
network-loaded dropdowns, duplicate-resourceId disambiguation). We must measure that
ourselves on the Android 35 emulator. The MCP servers are coordinate/a11y-bounds based and
may **not** by themselves fix the resourceId-collision pain that selector-rich Appium (or
AppAgent-style element enrichment) can.

## 2. Recommendation for the device-control layer

**Don't keep raw adb as the *only* path, but don't rip it out either.** We've already
hardened `AdbDriver` this milestone (text clear-before-type, `mInputShown` keyboard
detection, bounded scroll, focusable-gated dropdown detection), so the *marginal*
reliability gain from a backend swap is now smaller than it was. The remaining structural
wins a mature backend buys us are: **(a) richer selectors** (the duplicate-`resourceId`
pain — Appium's UiSelector supports `instance`/xpath/text), and **(b) iOS** for free.

Ranked fit behind the existing `DeviceDriver` interface:

1. **Appium (UiAutomator2 + XCUITest)** — primary "rich" backend to *prototype next*.
   Most mature, selector-rich, cross-platform → covers the resourceId pain and the
   iOS-later goal. Cost: heavier (Node server + driver install). 
2. **Maestro** — keep as the **replay/E2E backend** (already wired into codegen); great at
   deterministic replayable flows, less ideal as the fine-grained live-exploration driver.
3. **mobile-mcp** — attractive *because TS-native + cross-platform*, lowest integration
   friction; adopt only if a benchmark shows its a11y snapshots are rich enough (it's
   bounds-based, vendor-self-documented).
4. **raw adb (`AdbDriver`)** — keep as the **zero-dependency fallback** (works offline,
   no server). 
5. **uiautomator2 (Python)** — only if we decide a Python sidecar is acceptable; best
   Python ergonomics but off-stack.

> The highest-leverage work is **not** the backend swap — it's the Explorer *policy*
> (§3). Adopt those regardless of backend.

## 3. Prior-art for the LLM Explorer policy & state graph

All verified from primary papers/repos:

- **Hybrid "LLM maintains the graph, action selection is LLM-less"** — *LLM-Explorer*
  (MobiCom 2025): the LLM maintains a compact Abstract Interaction Graph; action choice is
  cheap/non-LLM → **fastest + highest coverage** vs 5 baselines, **~148× cheaper** than the
  SOTA LLM approach. → This validates the direction we already drifted toward (heuristic
  policy + LLM brain). **Lean into it for cost control**: call the LLM to label/reason and
  pick among pruned candidates, not on every trivial step. [arXiv 2505.10593](https://arxiv.org/pdf/2505.10593)
- **Multi-agent + self-critique** — *DroidAgent* (Planner/Actor/Observer/Reflector + 3
  memory modules, self-critique to escape bad trajectories) and *Mobile-Agent-v2*
  (planning/decision/reflection + memory, **>30%** task-completion gain over single-agent;
  *author-reported*). → A "Reflector" that notices loops/dead-ends maps onto our
  back-trapped / same-node-streak guards. [DroidAgent](https://coinse.github.io/publications/pdfs/Yoon2024aa.pdf) · [Mobile-Agent-v2](https://arxiv.org/abs/2406.01014)
- **UI-tree representation** — *DroidAgent* feeds a **hierarchical JSON** of widget props
  (resource-id / content-desc / text), explicitly rejecting flat concatenation (loses
  hierarchy) and HTML. → When we feed screens to the LLM Annotator/Explorer, use nested
  JSON, not a flat list.
- **Disambiguating duplicate resourceIds** — *AppAgent v2* fuses an accessibility/XML
  parser with **OCR + detection**, enriching each element with text + visual descriptors
  rather than relying on ID matching. → Our exact iHerb pain (8 fields share
  `input_edit_text`); enrich elements with label-text + bounds (+ later a vision pass)
  instead of trusting resourceId. [AppAgent v2](https://arxiv.org/pdf/2408.11824)
- **Persisted, resumable model** — *Fastbot2* persists a reusable per-package transition
  model (`.fbm`) and tracks activity coverage (resumable, not one-off). It outputs
  crashes/coverage, **not** a UI tree — prior art for *policy/persistence only*, not a
  backend. → Our IFG already is this persisted model; add "resume/extend a previous run".
  [Fastbot_Android](https://github.com/bytedance/Fastbot_Android)
- **Benchmark harness** — *Google AndroidWorld* (Apache-2.0): live-emulator benchmark, 116
  tasks / 20 apps, accessibility-based tap/swipe/type/scroll action space via AndroidEnv. →
  Model our own coverage/cost benchmark on this shape. [android_world](https://github.com/google-research/android_world)

## 4. Phased adoption roadmap (behind `DeviceDriver`, no big-bang)

**Phase 0 — Benchmark harness (do first; it's the decision instrument).**
A fixed suite of OAS pain cases runnable against *any* `DeviceDriver`, emitting a scorecard:
text replace-not-append · soft-keyboard detection · long-page scroll coverage · wait for a
network-loaded dropdown · pick the right element among duplicate resourceIds · time/cost.
Run it against the current `AdbDriver` to set the baseline.

**Phase 1 — `AppiumDriver` adapter (prototype).**
Implement `DeviceDriver` over Appium (UiAutomator2). Run the Phase-0 benchmark head-to-head
vs `AdbDriver`.
🔲 *Checkpoint:* adopt Appium as primary **only if** it materially beats hardened adb on the
scorecard (esp. duplicate-resourceId selection). Else keep adb, revisit later.

**Phase 2 — Explorer policy upgrades (backend-agnostic, higher leverage).**
- Hierarchical JSON tree to the LLM (DroidAgent).
- Element enrichment (label-text + bounds, later a vision pass) to disambiguate dup ids (AppAgent v2).
- LLM-maintains-graph + cheap action selection (LLM-Explorer) for cost.
- A "Reflector"-style loop check folding in our existing back-trap / same-node guards.
- Resume/extend a previous clone run (Fastbot2-style persistence; our IFG already persists).
🔲 *Checkpoint:* coverage + $/run on an AndroidWorld-style task set beats the current policy.

**Phase 3 — iOS via the same interface.**
Add `XcuitestDriver` (Appium) or use mobile-mcp; reuse Maestro for cross-platform replay.
No Explorer/IFG changes — the `DeviceDriver` abstraction is the seam.

## Open questions (need our own measurement — not answered by any source)
1. Which backend best solves *our* pains on Android 35 (no public head-to-head exists)?
2. Is a TS-native MCP server's lower friction worth its weaker (bounds-based) selectors vs Appium?
3. Does each backend expose the **full structured UI tree** (for the IFG), or only
   agent-facing action tools? (Must sit behind `DeviceDriver` for *both* observe + act.)
4. How do the academic policies' cost/latency hold up on real third-party apps (vs paper benchmark sets)?
