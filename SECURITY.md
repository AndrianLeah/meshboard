# Security policy

Meshboard has no server and no accounts, so its security rests on a few things: the board link,
the encrypted handshake, WebRTC between browsers, and careful handling of whatever comes in from
outside. This page explains what that covers, what it doesn't, and how to report a problem.

## Supported versions

Meshboard is a static site with no releases. Only the latest deploy of `main`, live at
[andrianleah.github.io/meshboard](https://andrianleah.github.io/meshboard/), is supported. Fixes
land on `main` and go live with the next deploy; installed copies (the PWA) pick up the new version
the next time they open online.

| Version | Supported |
| --- | --- |
| Latest deploy of `main` on GitHub Pages | ✅ |
| Older builds, forks and self-hosted copies | ❌ (update from `main`) |

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a security problem.** Report it
privately instead:

1. Open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to
   [the private reporting form](https://github.com/AndrianLeah/meshboard/security/advisories/new).
2. Describe what an attacker can do and what they need for it (for example: the board link or not,
   a peer in the room, an imported file).
3. Add the steps to reproduce: a crafted export file, the message a peer sends, or a short script.
   Include the browser and OS you tested on.

Never include a real board link: the link is the key to that board.

Meshboard is maintained by one person, so replies are best effort. You can expect an
acknowledgement within a week and an assessment soon after. Fixes are published as a GitHub
security advisory, with credit if you'd like it. Please keep the details private until the fix is
live, or for 90 days, whichever comes first.

## How Meshboard is protected

- **The board link is the only access control.** A board link looks like
  `…/meshboard/#<roomId>.<secret>`. Both parts are random (96 and 128 bits from
  `crypto.getRandomValues`, see [`src/core/identity.ts`](src/core/identity.ts)) and live after the
  `#`, so they never reach the web server. Anyone with the link can join, read and edit, and a
  name on the board is not an identity.
- **The secret encrypts the handshake.** Peers find each other through
  [Trystero](https://github.com/dmotz/trystero) on public [Nostr](https://nostr.com) relays. The
  connection offers they exchange there are encrypted with the secret, so relays see that peers
  are meeting, but not the secret or the board.
- **Data lives in browsers and flows peer to peer.** Every browser keeps its copy of a board in
  IndexedDB, and the user's name, id and recent board links in localStorage. Peers exchange edits
  and cursors directly over WebRTC data channels, which are encrypted with DTLS. No server stores
  boards.
- **Relays, STUN and TURN servers are third parties.** The public Nostr relays, the STUN servers
  that help browsers find a route to each other, and any TURN server a deployment adds are run by
  other people. They see IP addresses and timing, never the decrypted content.
- **Incoming data is untrusted.** Imported files, the clipboard and everything peers send are
  treated as hostile. Items from files, the clipboard and other peers are normalised by
  `sanitizeItem` in [`src/core/schema.ts`](src/core/schema.ts) (known types only, numbers clamped,
  text and lists capped; the board skips an item it can't repair), presence is cleaned in
  [`src/sync/presence.ts`](src/sync/presence.ts), and text is always rendered as text, never as
  HTML.

## In scope

- Joining, reading or changing a board without its link, or recovering the secret from what the
  relays, STUN/TURN servers or the web server can see.
- Script or HTML injection through anything that comes in: board content, an imported file, the
  clipboard, a peer's edits, names or reactions.
- A crafted file or peer message that gets past the checks in `src/core/schema.ts`, or that breaks
  the board for everyone in the room (it won't open, it freezes, it uses up memory).
- The board link or its content leaking to a third party: through a request, a `Referer` header,
  logs, the service worker's cache, or another origin.
- The deploy pipeline: the GitHub Actions workflows, the site published on GitHub Pages and the
  dependencies shipped in the bundle.

## Out of scope

- **Anything a person with the link can do by design:** read, edit, delete, export, or pick any
  name, including a teammate's. The link is the key: share it only with the people who should have
  it. A link can't be revoked; to shut someone out, export the board and start a new one.
- **Third-party infrastructure:** availability, logging or blocking by Nostr relays, STUN or TURN
  servers. Report those to their operators.
- **Peers seeing each other's IP addresses.** This is how WebRTC works.
- **A compromised device, browser profile or extension.** Boards and recent links are stored
  unencrypted in the browser, like any other site data.
- **Flooding a room or the relays with peers or traffic.** Meshboard is made for teams, not
  crowds.
- **Bugs in dependencies** (Yjs, Trystero and others) without a demonstrated impact on Meshboard.
  Report them upstream; Dependabot raises our security updates.
- **Forks and modified deployments**, and scanner findings without a working proof of concept, such
  as HTTP headers that GitHub Pages doesn't let a site set.
