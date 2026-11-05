# @extension-use/relay

Lets scripts, servers and AI agents drive a browser that runs an Extension-use extension. The extension dials out to the relay, so nothing listens on your computer except the relay itself (on 127.0.0.1 by default).

```bash
npx @extension-use/relay
```

Then pair the browser from the extension's control panel, and call it:

```bash
curl -H "Authorization: Bearer <token>" -d '{"action":"page.info"}' http://127.0.0.1:7777/v1/devices/default/calls
```

See the remote control guide in the Extension-use docs for pairing, tokens, the HTTP/SSE/WebSocket API and self-hosting.

License: MIT
