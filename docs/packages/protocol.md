# @extension-use/protocol

The shared language between hosts and clients: message envelopes, error codes, locator and target types, and zod schemas for every built-in action.

```bash
npm install @extension-use/protocol
```

You rarely install it yourself. `@extension-use/host` and `@extension-use/client` depend on it, and re-export what you need: `ExtensionUseError`, `ErrorCode`, `Locator`, `Target` and `CallOptions`.

## Entry points

| Import | Contents |
|---|---|
| `@extension-use/protocol` | `ExtensionUseError`, `ERROR_CODES`, `PROTOCOL_VERSION`, the envelope types (`hello`, `welcome`, `call`, `result`, `cancel`, `subscribe`, `event`, `progress`, `bye`), `Locator`, `Target`, `CallOptions`, `matchPattern()` |
| `@extension-use/protocol/schemas` | zod schemas for every built-in action (`coreActionSchemas`) and event (`coreEventSchemas`), and the `CoreActions` / `CoreEvents` type maps |
| `@extension-use/protocol/remote` | The frames between an extension and a relay, over one WebSocket |

## When you'd use it directly

- **Writing your own transport** or host in another runtime: implement the envelopes.
- **Validating action input** outside the extension, with the same schemas the router uses.
- **Generating docs or tools** from the schemas, as `pnpm docs:actions` does for the [action reference](../actions.md).

## Errors

```ts
import { ExtensionUseError, ERROR_CODES } from "@extension-use/protocol";

const err = new ExtensionUseError("NOT_GRANTED", 'This controller may not call "tabs.close"');
err.code;    // "NOT_GRANTED"
err.message;
err.data;    // optional extra data, e.g. { upgradeUrl } for QUOTA_EXCEEDED
ExtensionUseError.from(unknownError); // wraps anything; unknown errors become INTERNAL
```

See [error codes](../reference/errors.md).
