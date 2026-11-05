# Contributing

```bash
pnpm install
pnpm exec playwright install chromium
```

```bash
pnpm typecheck && pnpm test && pnpm test:e2e
```

- **Packages** live in `packages/`. Workspace packages resolve each other's TypeScript sources through the `source` export condition, so you don't need to build them during development. `pnpm test` and `pnpm test:e2e` build first, so they test what gets published.
- **Adding an action:**
  1. Add its schema to `packages/protocol/src/schemas.ts`.
  2. Implement it in `packages/host` (background group, content group or frame bridge).
  3. Add it to a group so `permissionsFor()` knows what it needs.
  4. Test it in `tests/e2e`.
  5. Run `pnpm docs:actions`.

  Actions must stay declarative: no running code, scripts or HTML sent by a controller (Chrome Web Store policy, and the security model).
- **Templates** for `npm create extension-use` are in `packages/create-extension-use/templates`. `shared/` is copied first, then the template's own folder. A `.skip` file lists shared files a template doesn't want.
- **Releases** use changesets: run `pnpm changeset` in your PR to describe the change.
