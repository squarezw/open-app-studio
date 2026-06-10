# @oas/codegen

App Spec → a standalone **Expo project** (expo-router, TypeScript, strict). Not a player shell: the output is normal React Native code with zero OAS runtime dependency.

```bash
oas-codegen --ifg runs/spike/ifg.json --out build/my-app   # blueprint-compile + generate
oas-codegen --spec spec.json --out build/my-app            # from an edited spec
cd build/my-app && npm install && npx expo start
maestro test e2e/                                          # cloned flows as acceptance tests
```

What gets generated:
- `app/` — one expo-router screen per spec screen; tabs or stack from `spec.navigation`
- `components/oas.tsx` — implementations of all 31 registry blocks (RN primitives only)
- `state/app-data.ts` — demo seeds for every data binding, so the app renders content immediately
- `theme/tokens.ts` — editable design tokens
- `e2e/*.yaml` — the source IFG's named flows **re-targeted at the generated UI** (original selectors → generated button/tab labels)

Guarantees: deterministic output (same spec → identical bytes, snapshot-tested); generated FakeShop clone typechecks clean against Expo SDK 52.
