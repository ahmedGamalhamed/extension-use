# @extension-use/relay

## 0.2.0

### Patch Changes

- 90bdfbc: `extension-use vendor` now copies `extension-use-offscreen.js`, which no-build extensions need for the tabCapture group. `ExtensionUseError` is exported from `@extension-use/host/background` and `@extension-use/host/content`, so custom actions can fail with a specific code. `extension-use-relay --help` prints the commands and options instead of starting a relay.
- Updated dependencies [4b7b305]
  - @extension-use/protocol@0.2.0
  - @extension-use/client@0.2.0
