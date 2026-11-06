# create-extension-use

`npm create extension-use` creates a working extension whose side panel loads your web app, plus a demo web app.

```bash
npm create extension-use@latest my-extension
```

| Option | Meaning |
|---|---|
| `--template <wxt\|plain\|vanilla>` | The build setup. Default: ask, or `plain` with `--yes`. |
| `--url <url>` | Where your web app runs. Default `http://localhost:5173/`. |
| `--name <name>` | The extension's name. Default: the folder name. |
| `--yes` | Use the defaults and don't ask. |

With npm, put options after `--`: `npm create extension-use@latest my-extension -- --template wxt`.

| Template | For |
|---|---|
| `wxt` | WXT projects, with `@extension-use/wxt` set up. |
| `plain` | TypeScript bundled with esbuild, no framework. |
| `vanilla` | Plain JavaScript with no build step. `npm install` copies prebuilt bundles in. |

See [start a new extension](../start/new-project.md) for what each template contains.
