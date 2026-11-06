---
"@extension-use/host": patch
"@extension-use/relay": patch
---

`extension-use vendor` now copies `extension-use-offscreen.js`, which no-build extensions need for the tabCapture group. `ExtensionUseError` is exported from `@extension-use/host/background` and `@extension-use/host/content`, so custom actions can fail with a specific code. `extension-use-relay --help` prints the commands and options instead of starting a relay.
