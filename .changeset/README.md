# Changesets

Run `pnpm changeset` to describe a change for the next release. All `@extension-use/*` packages and `create-extension-use` share one version (see `fixed` in `config.json`), so a user can install matching versions without thinking about it.

Releasing (maintainers): `pnpm changeset version`, review and commit, then `pnpm release`.
