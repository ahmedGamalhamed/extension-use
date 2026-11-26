import { defineConfig } from "vitepress";

const repo = "https://github.com/ahmedGamalhamed/extension-use";

function slugify(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

// DOCS_BASE lets the same build serve from a sub-path, e.g. "/extension-use/" on GitHub Pages.
const base = (process.env.DOCS_BASE ?? "/") as `/${string}/` | "/";

export default defineConfig({
  title: "Extension-use",
  description: "Packages that let a web app, a website, a script or an AI agent drive your browser extension through a typed, declarative set of actions.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  // design.md is the design notes for contributors. It stays in the repo, off the site.
  srcExclude: ["design.md"],
  head: [["link", { rel: "icon", href: `${base}favicon.svg`, type: "image/svg+xml" }]],
  markdown: {
    theme: { light: "github-light", dark: "github-dark" },
    // GitHub's heading ids, so links like actions.md#runtimeping work on GitHub and on this site.
    anchor: { slugify },
    headers: { slugify },
  },
  themeConfig: {
    logo: "/favicon.svg",
    nav: [
      { text: "Pick your packages", link: "/start/picker", activeMatch: "^/start/picker" },
      { text: "Guide", link: "/start/introduction", activeMatch: "^/(start|guides|recipes)/" },
      { text: "Packages", link: "/packages/", activeMatch: "^/packages/" },
      { text: "Reference", link: "/actions", activeMatch: "^/(actions|reference)" },
    ],
    sidebar: [
      {
        text: "Get started",
        items: [
          { text: "Introduction", link: "/start/introduction" },
          { text: "Pick your packages", link: "/start/picker" },
          { text: "Add to your extension", link: "/start/installation" },
          { text: "Start a new extension", link: "/start/new-project" },
        ],
      },
      {
        text: "Build setups",
        items: [
          { text: "WXT", link: "/guides/wxt" },
          { text: "Plain JS/TS and no build", link: "/guides/plain" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Controllers and transports", link: "/guides/controllers" },
          { text: "Action groups and permissions", link: "/guides/permissions" },
          { text: "Custom actions", link: "/guides/custom-actions" },
          { text: "Remote control (relay)", link: "/guides/remote" },
          { text: "AI agents (MCP)", link: "/guides/agents" },
          { text: "Testing", link: "/guides/testing" },
          { text: "Security and store policy", link: "/guides/security" },
          { text: "Recipes", link: "/recipes" },
        ],
      },
      {
        text: "Packages",
        items: [
          { text: "Overview", link: "/packages/" },
          { text: "@extension-use/host", link: "/packages/host" },
          { text: "@extension-use/client", link: "/packages/client" },
          { text: "@extension-use/protocol", link: "/packages/protocol" },
          { text: "@extension-use/wxt", link: "/packages/wxt" },
          { text: "@extension-use/relay", link: "/packages/relay" },
          { text: "@extension-use/mcp", link: "/packages/mcp" },
          { text: "@extension-use/testing", link: "/packages/testing" },
          { text: "create-extension-use", link: "/packages/create-extension-use" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Actions and events", link: "/actions" },
          { text: "Error codes", link: "/reference/errors" },
          { text: "Command line", link: "/reference/cli" },
          { text: "Contributing", link: "/reference/contributing" },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: "Edit this page" },
    footer: { message: "The SDK packages are released under the MIT license." },
  },
});
