# @oas/app-spec

The App Spec DSL — the buildable app definition (screens, components, navigation, data) — and the **Blueprint Compiler** that turns an IFG (or subgraph) into a draft spec.

- Schema: [schemas/app-spec.schema.json](../../schemas/app-spec.schema.json)
- Compiler rules (M2, deterministic): screen roles → registry default blocks · component patterns → `byPattern` lookups · forward edges → navigation buttons · launch fan-out (2–5 targets) → tab bar · observed form fields → data models. Provenance kept in `meta.sourceNodeIds`.
- Gateway endpoint: `POST /api/runs/:id/blueprint` `{nodeIds?, appName?}` → App Spec draft.

Coming next: the canvas patch API (`proposePatch/applyPatch`) and the M3 LLM refinement pass. Design: [docs/component-system.md](../../docs/component-system.md)
