# Action reference

Generated from `packages/protocol/src/schemas.ts` by `pnpm docs:actions`. Don't edit by hand.

Every action is called as `ext.<group>.<name>(input, { target?, timeoutMs?, signal? })`, or `ext.call("group.name", input, options)`.
Inputs are checked by the extension. Wrong input comes back as `INVALID_INPUT`.

A **locator** finds elements: `{ ref?, role?, name?, text?, testId?, css?, nth?, exact? }`. Give at least one of `ref`, `role`, `text`, `testId` or `css`; fields combine.
A **target** picks the tab: `{ tab?: "active" | tabId | { urlMatch }, frame?: "top" | frameId }`. The default is the active tab of the controller's window.

## Contents

- **runtime**: [`runtime.ping`](#runtimeping), [`runtime.describe`](#runtimedescribe)
- **run**: [`run.sequence`](#runsequence)
- **tabs**: [`tabs.list`](#tabslist), [`tabs.open`](#tabsopen), [`tabs.close`](#tabsclose), [`tabs.activate`](#tabsactivate), [`tabs.navigate`](#tabsnavigate), [`tabs.reload`](#tabsreload), [`tabs.waitForLoad`](#tabswaitforload)
- **capture**: [`capture.screenshot`](#capturescreenshot)
- **frames**: [`frames.list`](#frameslist)
- **page**: [`page.info`](#pageinfo), [`page.scroll`](#pagescroll)
- **dom**: [`dom.query`](#domquery), [`dom.text`](#domtext), [`dom.snapshot`](#domsnapshot), [`dom.click`](#domclick), [`dom.hover`](#domhover), [`dom.focus`](#domfocus), [`dom.type`](#domtype), [`dom.fill`](#domfill), [`dom.select`](#domselect), [`dom.check`](#domcheck), [`dom.press`](#dompress), [`dom.blur`](#domblur), [`dom.drag`](#domdrag), [`dom.upload`](#domupload), [`dom.scroll`](#domscroll), [`dom.wheel`](#domwheel), [`dom.selectText`](#domselecttext), [`dom.paste`](#dompaste), [`dom.pointer`](#dompointer), [`dom.scrollTo`](#domscrollto)
- **wait**: [`wait.for`](#waitfor)
- **overlay**: [`overlay.highlight`](#overlayhighlight), [`overlay.clear`](#overlayclear), [`overlay.toast`](#overlaytoast)
- **picker**: [`picker.start`](#pickerstart), [`picker.cancel`](#pickercancel)
- **permissions**: [`permissions.contains`](#permissionscontains), [`permissions.request`](#permissionsrequest), [`permissions.getAll`](#permissionsgetall)
- [Events](#events)

## runtime

### `runtime.ping`

Check the connection.

Runs in extension background.

**Input**

_No fields._

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `pong` | `true` | yes |  |
| `ts` | `number` | yes |  |

### `runtime.describe`

List the actions this controller may call, with JSON schemas for their input and output. Includes host-defined actions.

Runs in extension background.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `actions` | `string[]` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `host` | `{ id: string; name?: string; version?: string }` | yes |  |
| `actions` | `({ name: string; description: string; where: "background" \| "content" \| "bridge"; version: number; input: Record<string, unknown>; output: Record<string, unknown> })[]` | yes |  |

## run

### `run.sequence`

Run several actions in order in one round trip. Steps are plain data: no conditions or expressions. Each step is checked like a separate call.

Runs in extension background. Default timeout 120 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `steps` | `({ action: string; input?: unknown; target?: { tab?: "active" \| number \| { urlMatch: string }; frame?: "top" \| number \| { urlMatch: string } }; timeoutMs?: number; onError?: "stop" \| "continue"; pauseMs?: number })[]` | yes |  |
| `onError` | `"stop" \| "continue"` |  | default `"stop"` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `completed` | `number` | yes |  |
| `ok` | `boolean` | yes |  |
| `results` | `({ ok: true; action: string; output: unknown } \| { ok: false; action: string; error: { code: string; message: string } })[]` | yes |  |

## tabs

### `tabs.list`

List open tabs.

Runs in extension background.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `currentWindow` | `boolean` |  |  |
| `urlMatch` | `string` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tabs` | `{ id: number; windowId: number; url: string; title: string; active: boolean; status: string }[]` | yes |  |

### `tabs.open`

Open a URL in a new tab.

Runs in extension background. Default timeout 30 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | `string` | yes |  |
| `active` | `boolean` |  | default `true` |
| `waitForLoad` | `boolean` |  | default `true` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `number` | yes |  |
| `windowId` | `number` | yes |  |
| `url` | `string` | yes |  |
| `title` | `string` | yes |  |
| `active` | `boolean` | yes |  |
| `status` | `string` | yes |  |

### `tabs.close`

Close a tab.

Runs in extension background.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tabId` | `number` | yes |  |

**Output**

_No fields._

### `tabs.activate`

Focus a tab.

Runs in extension background.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tabId` | `number` | yes |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `number` | yes |  |
| `windowId` | `number` | yes |  |
| `url` | `string` | yes |  |
| `title` | `string` | yes |  |
| `active` | `boolean` | yes |  |
| `status` | `string` | yes |  |

### `tabs.navigate`

Navigate the target tab to a URL.

Runs in extension background. Default timeout 30 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | `string` | yes |  |
| `waitForLoad` | `boolean` |  | default `true` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `number` | yes |  |
| `windowId` | `number` | yes |  |
| `url` | `string` | yes |  |
| `title` | `string` | yes |  |
| `active` | `boolean` | yes |  |
| `status` | `string` | yes |  |

### `tabs.reload`

Reload the target tab.

Runs in extension background. Default timeout 30 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `waitForLoad` | `boolean` |  | default `true` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `number` | yes |  |
| `windowId` | `number` | yes |  |
| `url` | `string` | yes |  |
| `title` | `string` | yes |  |
| `active` | `boolean` | yes |  |
| `status` | `string` | yes |  |

### `tabs.waitForLoad`

Wait until the target tab has loaded.

Runs in extension background. Default timeout 30 s.

**Input**

_No fields._

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `number` | yes |  |
| `windowId` | `number` | yes |  |
| `url` | `string` | yes |  |
| `title` | `string` | yes |  |
| `active` | `boolean` | yes |  |
| `status` | `string` | yes |  |

## capture

### `capture.screenshot`

Capture the visible part of the target tab, or crop to one element.

Runs in extension background. Default timeout 15 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `format` | `"png" \| "jpeg"` |  | default `"png"` |
| `quality` | `number` |  | min 0, max 100 |
| `locator` | `Locator` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `dataUrl` | `string` | yes |  |
| `width` | `number` | yes |  |
| `height` | `number` | yes |  |

## frames

### `frames.list`

List the frames (iframes) in the target tab, to target one with { frame: frameId } or { frame: { urlMatch } }.

Runs in extension background.

**Input**

_No fields._

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `frames` | `{ frameId: number; parentFrameId: number; url: string }[]` | yes |  |

## page

### `page.info`

URL, title, viewport, scroll position and document size.

Runs in the page (content runtime).

**Input**

_No fields._

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | `string` | yes |  |
| `title` | `string` | yes |  |
| `viewport` | `{ width: number; height: number; devicePixelRatio: number }` | yes |  |
| `scroll` | `{ x: number; y: number }` | yes |  |
| `document` | `{ width: number; height: number }` | yes |  |

### `page.scroll`

Scroll the page to a position, by an amount, or to the top or bottom.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `x` | `number` |  |  |
| `y` | `number` |  |  |
| `by` | `boolean` |  | default `false` |
| `to` | `"top" \| "bottom"` |  |  |
| `behavior` | `"auto" \| "smooth" \| "instant"` |  | default `"instant"` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `scroll` | `{ x: number; y: number }` | yes |  |

## dom

### `dom.query`

Find elements and describe them.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `all` | `boolean` |  | default `false` |
| `limit` | `number` |  | default `50`, min 1, max 500 |
| `textMaxLength` | `number` |  | default `200`, min 0, max 9007199254740991 |
| `wait` | `boolean` |  | default `true` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `elements` | `{ ref: string; tag: string; role: string; name: string; text?: string; value?: string; checked?: boolean; disabled?: boolean; href?: string; attributes: Record<string, string>; box: { x: number; y: number; width: number; height: number }; visible: boolean }[]` | yes |  |

### `dom.text`

Readable text of the page or of one element.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` |  |  |
| `maxLength` | `number` |  | default `20000`, min 1, max 9007199254740991 |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | `string` | yes |  |
| `truncated` | `boolean` | yes |  |

### `dom.snapshot`

Compact accessibility-style tree with refs for interactive elements.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` |  |  |
| `maxNodes` | `number` |  | default `1500`, min 1, max 20000 |
| `interactiveOnly` | `boolean` |  | default `false` |
| `viewportOnly` | `boolean` |  | default `false` |
| `textMaxLength` | `number` |  | default `300`, min 10, max 5000 |
| `format` | `"tree" \| "text" \| "both"` |  | default `"both"` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `root` | `SnapshotNode` |  |  |
| `text` | `string` |  |  |
| `nodeCount` | `number` | yes |  |
| `truncated` | `boolean` | yes |  |

### `dom.click`

Click an element.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `button` | `"left" \| "middle" \| "right"` |  | default `"left"` |
| `clickCount` | `number` |  | default `1`, min 1, max 3 |
| `modifiers` | `("Alt" \| "Control" \| "Meta" \| "Shift")[]` |  | default `[]` |
| `holdMs` | `number` |  | default `0`, min 0, max 10000 |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |

### `dom.hover`

Move the pointer over an element.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |

### `dom.focus`

Focus an element.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |

### `dom.type`

Type text key by key into an element (or the focused element).

Runs in the page (content runtime). Default timeout 30 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` |  |  |
| `text` | `string` | yes |  |
| `delayMs` | `number` |  | default `0`, min 0, max 1000 |
| `clear` | `boolean` |  | default `false` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |

### `dom.fill`

Set the value of an input in one step.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `value` | `string` | yes |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |

### `dom.select`

Choose options in a <select> by value or label.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `values` | `string[]` | yes |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `selected` | `string[]` | yes |  |

### `dom.check`

Check or uncheck a checkbox or radio.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `checked` | `boolean` |  | default `true` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `checked` | `boolean` | yes |  |

### `dom.press`

Press a key on an element (or the focused element).

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` |  |  |
| `key` | `string` | yes |  |
| `modifiers` | `("Alt" \| "Control" \| "Meta" \| "Shift")[]` |  | default `[]` |

**Output**

_No fields._

### `dom.blur`

Take focus away from an element (or the focused element).

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` |  |  |

### `dom.drag`

Drag an element onto another element, or by an offset (sliders, sortable lists, HTML5 drag and drop).

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | `{ ref?: string; role?: string; name?: string; text?: string; testId?: string; css?: string; nth?: number; exact?: boolean }` | yes |  |
| `to` | `{ ref?: string; role?: string; name?: string; text?: string; testId?: string; css?: string; nth?: number; exact?: boolean }` |  |  |
| `offset` | `{ x: number; y: number }` |  |  |
| `steps` | `number` |  | default `10`, min 1, max 100 |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | `string` | yes |  |
| `to` | `string` |  |  |
| `html5` | `boolean` | yes |  |

### `dom.upload`

Give files to an <input type=file>, or drop them on a drop zone. Content is base64 (or text).

Runs in the page (content runtime). Default timeout 30 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `files` | `{ name: string; mimeType?: string; base64?: string; text?: string }[]` | yes |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `files` | `number` | yes |  |
| `via` | `"input" \| "drop"` | yes |  |

### `dom.scroll`

Scroll inside a scrollable element (a list, a panel) by an amount, to a position, or to an edge.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `x` | `number` |  |  |
| `y` | `number` |  |  |
| `by` | `boolean` |  | default `true` |
| `to` | `"top" \| "bottom" \| "left" \| "right"` |  |  |
| `behavior` | `"auto" \| "smooth" \| "instant"` |  | default `"instant"` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `scrollTop` | `number` | yes |  |
| `scrollLeft` | `number` | yes |  |
| `scrollHeight` | `number` | yes |  |
| `scrollWidth` | `number` | yes |  |
| `clientHeight` | `number` | yes |  |
| `clientWidth` | `number` | yes |  |

### `dom.wheel`

Turn the mouse wheel over an element (or the page). Fires wheel events, then scrolls if the page didn't cancel them.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` |  |  |
| `deltaX` | `number` |  | default `0` |
| `deltaY` | `number` |  | default `100` |
| `steps` | `number` |  | default `1`, min 1, max 50 |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` |  |  |
| `scrolled` | `boolean` | yes |  |
| `scrollTop` | `number` | yes |  |
| `scrollLeft` | `number` | yes |  |

### `dom.selectText`

Select text: a range in an input, part of an element's text, or all of it.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `start` | `number` |  | min 0, max 9007199254740991 |
| `end` | `number` |  | min 0, max 9007199254740991 |
| `text` | `string` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `selected` | `string` | yes |  |

### `dom.paste`

Paste text into an element (or the focused element): fires a paste event, then inserts the text unless the page handled it.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` |  |  |
| `text` | `string` | yes |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `handledByPage` | `boolean` | yes |  |

### `dom.pointer`

Low-level pointer: press, move or release at an element (or viewport point). For custom gestures.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"down" \| "move" \| "up"` | yes |  |
| `locator` | `Locator` |  |  |
| `x` | `number` |  |  |
| `y` | `number` |  |  |
| `button` | `"left" \| "middle" \| "right"` |  | default `"left"` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` |  |  |
| `x` | `number` | yes |  |
| `y` | `number` | yes |  |

### `dom.scrollTo`

Scroll an element into view.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `block` | `"start" \| "center" \| "end" \| "nearest"` |  | default `"center"` |
| `behavior` | `"auto" \| "smooth" \| "instant"` |  | default `"instant"` |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |

## wait

### `wait.for`

Wait for an element state or a URL.

Runs in the page (content runtime). Default timeout 15 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` |  |  |
| `state` | `"attached" \| "detached" \| "visible" \| "hidden"` |  | default `"visible"` |
| `urlMatch` | `string` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` |  |  |

## overlay

### `overlay.highlight`

Outline elements on the page, with an optional label.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `locator` | `Locator` | yes |  |
| `all` | `boolean` |  | default `false` |
| `label` | `string` |  |  |
| `color` | `string` |  | default `"#7c3aed"` |
| `durationMs` | `number` |  | default `0`, min 0, max 9007199254740991 |
| `id` | `string` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes |  |
| `count` | `number` | yes |  |

### `overlay.clear`

Remove highlights (one id, or all).

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` |  |  |

**Output**

_No fields._

### `overlay.toast`

Show a short message on the page.

Runs in the page (content runtime).

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | `string` | yes | max length 500 |
| `kind` | `"info" \| "success" \| "error"` |  | default `"info"` |
| `durationMs` | `number` |  | default `3000`, min 500, max 30000 |

**Output**

_No fields._

## picker

### `picker.start`

Let the person pick an element. Resolves with its locator; Esc cancels.

Runs in the page (content runtime). Default timeout 120 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | `string` |  | max length 200 |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `locator` | `Locator` | yes |  |
| `element` | `{ ref: string; tag: string; role: string; name: string; text?: string; value?: string; checked?: boolean; disabled?: boolean; href?: string; attributes: Record<string, string>; box: { x: number; y: number; width: number; height: number }; visible: boolean }` | yes |  |

### `picker.cancel`

Stop an active picker.

Runs in the page (content runtime).

**Input**

_No fields._

**Output**

_No fields._

## permissions

### `permissions.contains`

Check whether the extension has these permissions or host origins.

Runs in the frame bridge (side panel page); frame controllers only.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `permissions` | `string[]` |  |  |
| `origins` | `string[]` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `granted` | `boolean` | yes |  |

### `permissions.request`

Ask the person for optional permissions or host origins. Needs a click in the frame within the last few seconds.

Runs in the frame bridge (side panel page); frame controllers only. Default timeout 120 s.

**Input**

| Field | Type | Required | Notes |
|---|---|---|---|
| `permissions` | `string[]` |  |  |
| `origins` | `string[]` |  |  |

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `granted` | `boolean` | yes |  |

### `permissions.getAll`

List the permissions and host origins the extension has now.

Runs in the frame bridge (side panel page); frame controllers only.

**Input**

_No fields._

**Output**

| Field | Type | Required | Notes |
|---|---|---|---|
| `permissions` | `string[]` | yes |  |
| `origins` | `string[]` | yes |  |

## Events

Subscribe with `ext.on(name, handler)`. Patterns like `"tab.*"` work.

### `tab.updated`

| Field | Type | Required | Notes |
|---|---|---|---|
| `tab` | `{ id: number; windowId: number; url: string; title: string; active: boolean; status: string }` | yes |  |
| `changes` | `Record<string, unknown>` | yes |  |

### `tab.activated`

| Field | Type | Required | Notes |
|---|---|---|---|
| `tabId` | `number` | yes |  |
| `windowId` | `number` | yes |  |

### `tab.removed`

| Field | Type | Required | Notes |
|---|---|---|---|
| `tabId` | `number` | yes |  |

### `picker.selected`

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `locator` | `Record<string, string>` | yes |  |
| `url` | `string` | yes |  |

### `picker.hovered`

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | `string` | yes |  |
| `role` | `string` | yes |  |
| `name` | `string` | yes |  |

