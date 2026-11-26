# Security policy

Extension-use lets other software drive a person's real, signed-in browser, so security reports get priority.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub instead: on the repository's **Security** tab, choose **Report a vulnerability**.

Include what an attacker can do, the affected package and version, and the steps to reproduce it. You'll get a reply within 7 days. Once a fix ships, the advisory credits you unless you'd rather stay anonymous.

## What's in scope

- A controller calling an action it wasn't granted, or reaching a site the host's policy blocks.
- Anything that runs code a controller sent (actions must stay declarative).
- Reading or filling password and payment fields, which the runtime refuses.
- Origin checks in the frame and page transports.
- Relay authentication, pairing codes, tokens and isolation between devices.
- The kill switch or visible-control indicator failing to work.

Bugs in an extension built with the SDK belong to that extension's authors, unless the SDK itself causes them.

## Supported versions

Until 1.0, only the latest 0.x release gets security fixes.
