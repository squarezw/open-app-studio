# @oas/component-registry

The built-in block library: **31 component manifests** with IFG pattern tags, prop contracts, and slot declarations, plus registry lookups (`byRef`, `byPattern(kind, role?)`, `forRole`).

Manifests are what the Blueprint Compiler and the canvas need; the React Native implementations land alongside codegen (M2 second half). The AI Component Generator pipeline (generate → sandbox → preview → accept) is M3.

Design: [docs/component-system.md](../../docs/component-system.md)
