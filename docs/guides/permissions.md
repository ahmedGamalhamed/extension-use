# Action groups and permissions

Actions come in **groups**. You choose which groups your extension enables, and the manifest permissions follow from that choice. Fewer groups means fewer permissions, and a shorter permission prompt for your users.

## The groups

| Group | Actions | Manifest permissions | Page access |
|---|---|---|---|
| `runtime` | `runtime.ping`, `runtime.describe` | none | no |
| `run` | `run.sequence` | none | no |
| `tabs` | `tabs.list/open/close/activate/navigate/reload/waitForLoad/goBack/goForward/update` | `tabs` | no |
| `windows` | `windows.list/open/update/close` | none | no |
| `capture` | `capture.screenshot`, `capture.fullPage` | none | yes |
| `frames` | `frames.list` | `webNavigation` | no |
| `page` | `page.info`, `page.scroll` | none | yes |
| `dom` | `dom.query/text/snapshot/html`, `dom.click/hover/focus/blur/drag/pointer`, `dom.type/fill/press/paste/selectText`, `dom.select/check/upload`, `dom.scroll/scrollTo/wheel` | none | yes |
| `edit` | `edit.setHtml/setText/setAttributes/remove` | none | yes |
| `wait` | `wait.for` | none | yes |
| `overlay` | `overlay.highlight/clear/toast` | none | yes |
| `picker` | `picker.start/cancel` | none | yes |
| `tabCapture` *(opt-in)* | `tabCapture.start/stop/list` | `tabCapture`, `offscreen` | no |
| `downloads` *(opt-in)* | `downloads.start/list/cancel` | `downloads` | no |
| `bookmarks` *(opt-in)* | `bookmarks.search/list/create/update/remove` | `bookmarks` | no |
| `history` *(opt-in)* | `history.search/delete` | `history` | no |
| `cookies` *(opt-in)* | `cookies.list/set/remove` | `cookies` | no |

**Page access** means the group runs in pages. It adds `host_permissions` (`<all_urls>` by default) and `scripting`, which lets the host inject the content script into tabs that were open before install.

`permissions.request/contains/getAll` always exist for frame controllers. They run in the frame bridge and need no group.

The **opt-in groups** reach the person's data outside any page, or need extra files. No host gets them unless it names them. Site policy still applies: cookies, downloads and bookmarks of blocked sites are refused, and `javascript:` bookmarks can't be created.

## Enabling groups

Name the same groups in two places: in `defineHost()` (what the router offers) and in the manifest (what Chrome allows).

```ts
import { allBuiltinGroups, builtinGroups, defineHost } from "@extension-use/host/background";

defineHost({
  id: "my-extension",
  // Default: allBuiltinGroups (every group except the opt-in ones).
  groups: [...allBuiltinGroups, builtinGroups.cookies],
  controllers: { frame: { origins: ["https://app.example.com"] } },
});
```

Or a narrow set:

```ts
const { runtime, tabs, page, dom, overlay } = builtinGroups;
defineHost({ id: "my-extension", groups: [runtime, tabs, page, dom, overlay], controllers: { /* … */ } });
```

If an action's group is missing from the manifest side, the permission it needs is missing too, and its actions fail or return less (for example, tab URLs need the `tabs` permission). Keep the two lists in one shared constant, as the templates do in `groups.ts`.

## Filling in the manifest

Pick whichever fits your build. All three produce the same fields: `permissions`, `host_permissions` and `externally_connectable`.

**WXT**: the [`@extension-use/wxt`](../packages/wxt.md) module.

```ts
// wxt.config.ts
export default defineConfig({
  modules: ["@extension-use/wxt"],
  extensionUse: {
    groups: ["runtime", "tabs", "page", "dom", "overlay"],
    controllerOrigins: ["https://app.example.com"],
  },
});
```

**In code**: `withExtensionUse()` returns a copy of your manifest with the fields merged in.

```ts
import { withExtensionUse } from "@extension-use/host/permissions";

const manifest = withExtensionUse(baseManifest, {
  groups: ["runtime", "tabs", "page", "dom", "overlay"],
  controllerOrigins: ["https://app.example.com"],
  remote: true,
});
```

**The CLI**: merges into `manifest.json` (or the `manifest` key of `package.json`) and keeps your other entries.

```bash
npx extension-use manifest --groups runtime,tabs,page,dom,overlay --origins https://app.example.com --write manifest.json
```

| Option (code / CLI) | Meaning |
|---|---|
| `groups` / `--groups` | Groups the host enables. Default: all but the opt-in ones. |
| `controllerOrigins` / `--origins` | Websites that connect from a normal tab. Adds `externally_connectable.matches`. |
| `matches` / `--matches` | Pages the content runtime may run on. Default `<all_urls>`. |
| `remote` / `--remote` | Remote control through a relay. Adds `storage` and `alarms`. |
| `sidePanel` / `--no-side-panel` | Adds `sidePanel`. Default on. |
| `injectOnDemand` | Adds `scripting` to inject the content script on demand. Default on. |

`permissionsFor(groups, options)` returns just `{ permissions, host_permissions }`, if you build the manifest yourself.

## Smaller content scripts

The content runtime includes every page group by default. Pass only the ones you use, and the rest aren't bundled:

```ts
import { contentGroups, startContentRuntime } from "@extension-use/host/content";

startContentRuntime({ groups: [contentGroups.page, contentGroups.dom, contentGroups.overlay] });
```

Content groups: `page`, `dom`, `edit`, `wait`, `overlay`, `picker`. The whole runtime is about 9 KB gzipped.

## Asking for sites at the moment of use

You can ship with no host permissions for a site and ask when the person needs it. List the origins under `optional_host_permissions` in the manifest, narrow `matches`, then call `permissions.request` from a click handler in your side panel app:

```ts
button.onclick = async () => {
  const { granted } = await ext.permissions.request({ origins: ["https://*.shop.example/*"] });
  if (granted) await ext.tabs.reload();
};
```

Without a recent click, it fails with `NEEDS_USER_GESTURE`. Only frame controllers have `permissions.*`. See [recipe 6](../recipes.md#6-ask-for-a-site-only-when-needed).
