# @oas/device-bridge

Uniform device-automation interface for agents: `screenshot() · uiTree() · tap() · swipe() · type() · back() · launch() · deepLink()`, with every call recorded as a TraceEvent.

Backends:
- **Maestro** (default, iOS + Android)
- **Appium** (WDA / uiautomator2) for raw element trees and complex gestures
- **adb / simctl** for app install and device lifecycle

Design: [docs/architecture.md](../../docs/architecture.md) §Device Bridge

Status: not yet scaffolded — see [Roadmap M0](../../docs/roadmap.md).
