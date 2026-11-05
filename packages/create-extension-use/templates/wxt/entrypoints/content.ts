import { startContentRuntime } from "@extension-use/host/content";

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  matchAboutBlank: true,
  main() {
    startContentRuntime();
  },
});
