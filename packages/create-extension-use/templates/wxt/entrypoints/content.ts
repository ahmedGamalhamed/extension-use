import { startContentRuntime } from "@extension-use/host/content";

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    startContentRuntime();
  },
});
