<!--@include: ../../CONTRIBUTING.md-->

## Working on these docs

The site is built with [VitePress](https://vitepress.dev) from the `docs/` folder.

```bash
pnpm docs:dev
```

```bash
pnpm docs:build
```

The site is served at [extension-use.appzlr.com](https://extension-use.appzlr.com) by a Cloudflare Worker with static assets (`docs/wrangler.jsonc`). To publish, with `wrangler` logged in:

```bash
pnpm docs:deploy
```

- The [action reference](../actions.md) is generated from the schemas. Run `pnpm docs:actions` after changing an action, and don't edit `actions.md` by hand.
- The package picker is a Vue component in `docs/.vitepress/theme/components/PackagePicker.vue`. Update it when an option, entry point or command changes.
- Link between pages with relative `.md` paths, so links work on GitHub and on the site.
