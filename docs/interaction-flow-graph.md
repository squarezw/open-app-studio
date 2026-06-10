# Interaction Flow Graph (IFG)

The IFG is OAS's central data structure: a directed graph of **observed app behavior**. Nodes are screen states; edges are user actions that transition between them. It is produced by the Clone Engine, rendered by Studio, replayed via device-bridge, and compiled into App Spec by the Blueprint Compiler.

Machine-readable schema: [`schemas/ifg.schema.json`](../schemas/ifg.schema.json).

## Design principles

1. **Evidence-backed** — every node and edge links to raw observations (screenshots, UI trees, trace events). Semantic labels are layered *on top* and always traceable to evidence.
2. **Replayable** — every edge stores enough (selector + fallback point + preconditions) to re-execute the action on a live device.
3. **Content-invariant** — node identity is structural. Two feed screens with different posts are one node.
4. **Compilable** — component-pattern tags and flow annotations are exactly the inputs the Blueprint Compiler needs.

## Data model

```
InteractionFlowGraph
├── meta            run info: app id, store URL, platform, device, coverage stats
├── nodes[]         ScreenNode
├── edges[]         ActionEdge
├── flows[]         Flow (named path through edges, e.g. "Checkout")
└── frontier[]      observed-but-unexplored interactions
```

### ScreenNode

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable within graph |
| `fingerprint` | string | structural layout hash — the dedup key |
| `routeHint` | string? | Android activity / iOS accessibility id |
| `role` | enum? | `launch · onboarding · auth · feed · list · detail · form · cart · checkout · settings · profile · search · modal · webview · other` |
| `title` | string? | human label from Annotator ("Login") |
| `patterns[]` | ComponentPattern[] | detected UI patterns with bounding regions |
| `evidence[]` | Evidence[] | screenshots + UI tree dumps (object-storage refs) |
| `visits` | int | observation count |

`ComponentPattern`: `{ kind: tabbar | navbar | list | grid | card | form | button | input | carousel | map | video | chart | dialog | other, region: {x,y,w,h}, fields?: [...] }` — for forms, `fields` captures observed inputs (label, keyboard type, validation hints), which become data-model candidates.

### ActionEdge

| Field | Type | Notes |
|---|---|---|
| `id` / `from` / `to` | string | graph topology |
| `action.kind` | enum | `tap · longPress · swipe · type · scroll · back · deepLink · launch · system` |
| `action.selector` | Selector | UI-tree selector (preferred for replay) |
| `action.point` | {x,y}? | screen-relative fallback |
| `action.inputValue` | string? | synthesized form input (sanitized — never real credentials) |
| `guard` | enum? | `none · loginRequired · paymentBoundary · destructive` — guarded edges are never auto-traversed past the boundary |
| `evidence[]` | Evidence[] | before/after screenshot pairs |
| `latencyMs` | int? | observed transition time |

### Flow

`{ id, name, description, edgeIds[], coverage: observed|inferred }` — a named, ordered path ("Onboarding", "Purchase"). Flows export 1:1 to Maestro YAML for replay/E2E testing.

### Frontier

`{ nodeId, selector, reason: unexplored | blocked-login | blocked-payment | budget }` — honest accounting of what was *not* explored, surfaced in the Studio coverage report and consumable by a follow-up run.

## Example (abridged)

```jsonc
{
  "meta": {
    "appName": "FoodFast",
    "storeUrl": "https://apps.apple.com/app/id123456",
    "platform": "android-emulator",
    "coverage": { "nodes": 42, "frontier": 7, "blocked": 3 }
  },
  "nodes": [
    {
      "id": "n_cart",
      "fingerprint": "lh1:9f3ac2…",
      "role": "cart",
      "title": "Shopping Cart",
      "patterns": [
        { "kind": "list", "region": { "x": 0, "y": 120, "w": 1080, "h": 1400 } },
        { "kind": "button", "region": { "x": 60, "y": 1980, "w": 960, "h": 140 } }
      ],
      "evidence": [{ "type": "screenshot", "ref": "blob://run1/n_cart_01.png" }],
      "visits": 6
    }
  ],
  "edges": [
    {
      "id": "e_cart_checkout",
      "from": "n_cart",
      "to": "n_address",
      "action": { "kind": "tap", "selector": { "text": "Checkout" }, "point": { "x": 540, "y": 2050 } },
      "guard": "none"
    }
  ],
  "flows": [
    { "id": "f_purchase", "name": "Purchase", "edgeIds": ["e_home_item", "e_item_cart", "e_cart_checkout", "e_address_payment"], "coverage": "observed" }
  ],
  "frontier": [
    { "nodeId": "n_payment", "selector": { "text": "Pay now" }, "reason": "blocked-payment" }
  ]
}
```

## Graph operations (`packages/flow-graph`)

- `merge(trace) → delta` — fold a TraceEvent stream into the graph (Cartographer's core)
- `fingerprint(uiTree) → hash` — structural layout hashing
- `diff(g1, g2)` — compare two IFGs (app version changes; cloned vs rebuilt)
- `pathTo(nodeId)` / `replayScript(flow) → Maestro YAML`
- `subgraph(nodeIds) → IFG` — extract a region for partial blueprinting
- `toBlueprintInput(ifg | subgraph)` — strip evidence, keep structure + patterns, for the Blueprint Compiler
