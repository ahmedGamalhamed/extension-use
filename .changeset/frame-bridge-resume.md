---
"@extension-use/host": patch
---

Frame bridge: keep working after Chrome stops the idle background service worker. The bridge now resumes the app's session (hello and event subscriptions) on a new port, and fails in-flight calls at once with `NOT_CONNECTED` instead of letting them time out. Before, every call failed with "Send hello first" until the app reloaded.
