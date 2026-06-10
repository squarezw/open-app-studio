# Build & Publish

From App Spec to signed binaries on both stores.

## 1. Codegen (`packages/codegen`)

App Spec → a real, standalone **Expo project** (TypeScript). Not a player shell: the output is normal React Native code a developer could eject to and maintain by hand.

```
codegen(appSpec, registry) →
  app/                  # expo-router screens, one file per spec screen
  components/           # copied registry components used by the spec
  navigation generated from spec.navigation (expo-router conventions)
  state/                # zustand stores from spec.data.models
  api/                  # typed clients from spec.data.sources
  theme/                # token files from spec theme
  e2e/                  # Maestro flows — including flows exported from the source IFG
```

Codegen rules:
- **Deterministic** — same spec + registry version → identical output (snapshot-testable).
- **Readable output** — generated code follows standard Expo conventions; comments only where the spec can't express something.
- **Regenerable with escape hatch** — `oas eject <screen>` marks a screen as hand-maintained; codegen stops overwriting it and diffs instead.

The IFG-exported Maestro flows become **E2E tests for the rebuilt app**: "the clone's checkout should pass the same 4-screen flow observed in the original." This closes the loop — cloning produces both the app *and* its acceptance tests.

## 2. Build pipeline

| Mode | iOS | Android |
|---|---|---|
| **Local dev** | Expo Go / dev client on simulator | Expo Go / dev client on emulator |
| **Cloud build (default)** | **EAS Build** — managed signing (certs/profiles) | **EAS Build** — managed keystore |
| **Self-hosted CI** | fastlane gym on macOS runner | Gradle on Linux runner |

EAS is the v1 default because it removes the two worst onboarding cliffs: iOS code signing and store credentials management. The self-hosted path (fastlane match + gym / Gradle) is documented for teams who can't use a hosted service — OAS itself stays vendor-neutral: builds are driven through a `BuildProvider` interface (`eas` | `fastlane`).

## 3. Store submission

| Step | iOS (App Store) | Android (Google Play) |
|---|---|---|
| Credentials | App Store Connect API key (user-provided) | Play Console service account JSON |
| Upload | EAS Submit / fastlane deliver | EAS Submit / fastlane supply |
| Listing | Generated draft: name, subtitle, description, keywords — drafted by AI from the App Spec, edited by user | Same |
| Screenshots | Auto-captured: run the generated app's Maestro flows on simulator, screenshot key screens, frame them | Same on emulator |
| Review prep | Checklist agent: privacy manifest, ATT, account-deletion requirement, demo account for review | Data-safety form draft, target-API check |

The **Listing Agent** drafts store metadata but never submits without explicit user confirmation — submission is an outward-facing, review-consuming action.

## 4. Release management

- Versioning: spec version → semver → build number auto-increment.
- **OTA updates** (Expo Updates) for JS-only changes; store builds only when native config changes.
- Track state per store: `draft → building → submitted → in-review → live`, surfaced in Studio.

## 5. Compliance notes for cloned apps

Store review explicitly rejects apps that impersonate or duplicate others (App Store Review Guideline 4.1 "Copycats"; Play "Impersonation" policy). The Ship pipeline runs a **similarity self-check** before submission: if the app's name/icon/listing is confusingly similar to the cloned source, it warns and requires the user to differentiate. OAS's position: clone the *structure* to learn and bootstrap, then make it yours.
