<div align="center">

<img src="public/icons/icon-512.png" width="112" alt="Meshboard logo" />

# Meshboard

**The team whiteboard with no server.**

Sticky notes, shapes, frames, connectors and emoji reactions in real time.<br />
Browsers talk to each other directly: no accounts, no backend, nothing to pay for.

[**Open Meshboard →**](https://andrianleah.github.io/meshboard/) &nbsp;·&nbsp; [How it works](#how-it-works) &nbsp;·&nbsp; [Host your own](#host-your-own-in-5-minutes)

[![Deploy](https://github.com/AndrianLeah/meshboard/actions/workflows/deploy.yml/badge.svg)](https://github.com/AndrianLeah/meshboard/actions/workflows/deploy.yml)
[![License: MIT](docs/badges/license.svg)](LICENSE)
[![Backend: none](docs/badges/backend.svg)](#how-it-works)
[![PWA: installable](docs/badges/pwa.svg)](#try-it)

</div>

<br />

![A sprint retro in Meshboard: three frames of sticky notes with emoji reactions, connectors, a selected note with its context bar and the live cursors of two teammates](public/screenshots/board-wide.png)

## Why

Online whiteboards are great until everyone needs an account, your notes live on somebody else's
server and the free plan runs out after three boards. Meshboard is a static web page: create a
board, send the link, and you're working together. The content only ever lives in the
participants' browsers.

## Features

| | |
| --- | --- |
| 🗒️ **Sticky notes that fit their text** | Text is centred and sized to fit the note. Double-click anywhere for a new note, or use the **+** around a selected one to add the next. |
| 🔷 **Shapes, text, frames and a pen** | Rectangles, ovals, triangles, diamonds, text boxes and freehand strokes in eight colours. Frames are titled sheets that carry their content when they move. |
| ↗️ **Connectors** | Drag from the dots around any item to another one: the line follows both. Arrow ends and dashed lines from the context bar. |
| 🎉 **Reactions** | Any emoji on any note, from a searchable picker that remembers your favourites. Hover a chip to see who reacted. |
| 🧭 **Familiar controls** | Context bar above the selection, right-click menu, smart guides, copy and paste, groups, locks and the shortcuts other whiteboards use (press <kbd>?</kbd>). |
| 🖱️ **Live presence** | See who's online and where their cursor is, in real time. |
| ↩️ **Personal undo** | Undo and redo only touch your own changes, never a teammate's. |
| 💾 **Import / export** | Save a board as JSON, add it to another board or start a new one from the file. |
| 📱 **Installable, works offline** | A PWA for desktop and mobile. Edit offline; changes merge when you're back. |
| 🔒 **Private by link** | The link is the key: the handshake is encrypted with a secret that only lives in the link. |

<table>
  <tr>
    <td width="62%"><img src="docs/detail-reactions.png" alt="Close-up of sticky notes with emoji reactions, connectors and a teammate's cursor" /></td>
    <td width="38%"><img src="public/screenshots/board-narrow.png" alt="The same board on a phone" /></td>
  </tr>
</table>

## How it works

```mermaid
flowchart LR
  A["Anna's browser"] <-->|"WebRTC, encrypted"| B["Marco's browser"]
  B <-->|"WebRTC, encrypted"| C["Giulia's browser"]
  A <-->|"WebRTC, encrypted"| C
  R[("Public Nostr relays")] -.->|"introductions only"| A
  R -.-> B
  R -.-> C
```

- **The link is the room.** A new board gets a link like `…/meshboard/#<room>.<secret>`. The part
  after `#` never reaches the web server: the room id lets peers find each other, and the secret
  encrypts the handshake so nobody without the link can join.
- **Browsers connect directly.** [Trystero](https://github.com/dmotz/trystero) uses public
  [Nostr](https://nostr.com) relays only for introductions. After that, everything flows over
  encrypted WebRTC data channels, browser to browser.
- **Edits merge without conflicts.** The board is a [Yjs](https://yjs.dev) CRDT document: people
  can edit at the same time, and anyone who was offline catches up automatically on reconnect.
- **Every browser keeps a copy.** Boards are stored in IndexedDB, so you can close the tab and
  find your board again under *Recent boards*.

## Try it

1. Open **[andrianleah.github.io/meshboard](https://andrianleah.github.io/meshboard/)**, type your
   name and create a board.
2. Click **Share** and send the link to your teammates.
3. Want a head start? Download [`examples/retro-sprint.json`](examples/retro-sprint.json) and pick
   **Open an exported file** on the home screen.

**Install it as an app:** in Chrome or Edge, use the install icon in the address bar (or *Install
as app* in the board menu). On iPhone, use *Share → Add to Home Screen*.

<p align="center">
  <img src="docs/home.png" width="460" alt="The Meshboard home screen with your name, a button to create a board and the recent boards in this browser" />
</p>

## Host your own in 5 minutes

Meshboard is a static site: GitHub Pages is all it needs.

1. **Fork** this repository.
2. In your fork, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the *Deploy to GitHub Pages* workflow). Your copy is live at
   `https://<you>.github.io/meshboard/`.

## Good to know

- **A name is not a login.** Anyone with the link can join and pick any name. Share links only
  with the people who should be on the board.
- **A board lives with the people who use it.** When nobody has it open, it exists only in the
  browsers that had it. Use **Export** to keep a long-term copy.
- **Some corporate networks block peer-to-peer.** If teammates can't connect, add a TURN server
  (Cloudflare and Metered have free tiers) by passing `turnConfig` to `connect()` in
  [`src/sync/index.js`](src/sync/index.js).
- **Made for teams, not crowds.** Every browser connects to every other one: perfect for a team,
  not for hundreds of people on the same board.

## Development

Requires Node 22 or later.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # model, geometry, files, clipboard and keymap tests
npm run tokens  # regenerate src/styles/tokens.css from mockup/tokens/variables.css
npm run build   # production build in dist/, service worker included
```

To simulate two people on one machine, open the app on both `http://localhost:5173` and
`http://127.0.0.1:5173` (or in a private window): each one gets its own name and storage.

The interface is built on a small design system: colours, spacing, radii and sizes are tokens exported
from the FigCraft mockup ([`mockup/`](mockup/)), and every control comes from the same primitives.

| Folder | What it holds |
| --- | --- |
| [`src/core/`](src/core/) | The board model on Yjs, item schema and migrations, geometry, clipboard and files (no DOM: tested in Node) |
| [`src/sync/`](src/sync/) | IndexedDB copy, peer-to-peer transport (Trystero) and presence |
| [`src/board/`](src/board/) | The canvas: view (pan, zoom, wheel), renderers, overlay and one file per tool |
| [`src/commands/`](src/commands/) | Every action by id, and the one shortcut table behind keys, tooltips and the shortcuts panel |
| [`src/ui/`](src/ui/) | Toolbar, context bar, menus, emoji picker; [`ui/ds/`](src/ui/ds/) is the design system's JavaScript side |
| [`src/styles/`](src/styles/) | Generated tokens, the design system ([`ds/`](src/styles/ds/)) and layout |
| [`src/pages/`](src/pages/), [`src/app/`](src/app/) | Home and board screens; install prompt and offline service worker |

<details>
<summary><strong>Export format</strong></summary>

```json
{
  "format": "meshboard",
  "version": 2,
  "title": "Sprint 42 retro",
  "users": { "<id>": "Anna" },
  "items": [
    { "id": "n1", "type": "note", "x": 0, "y": 0, "w": 220, "h": 220,
      "color": "yellow", "text": "Move the daily stand-up to 9:45",
      "author": "<id>", "reactions": { "🎉": { "<id>": 1795500000000 } } },
    { "id": "f1", "type": "frame", "x": -40, "y": -40, "w": 600, "h": 400,
      "color": "gray", "text": "Action items" },
    { "id": "a1", "type": "arrow", "from": "n1", "to": "n2",
      "x1": 0, "y1": 0, "x2": 0, "y2": 0, "color": "gray",
      "start": "none", "end": "arrow", "dash": false }
  ]
}
```

Item types are `note`, `rect`, `ellipse`, `triangle`, `diamond`, `text`, `frame`, `path` (pen
strokes) and `arrow`. Arrows store their end points (`x1, y1, x2, y2`) and, when attached, the ids
of the items they connect (`from`, `to`). Any item can carry `locked` and a `group` id. Reactions
map each emoji to who reacted and when. Version 1 files still open: their 👍 / 👎 votes become
reactions.

</details>

## Brand

The icon is three sticky notes woven into a ring: each one rests on a neighbour and tucks under
the other, so no note sits on top of the rest, just like the peers on a board. It was drawn in
VectorCraft; the source file and design notes are in [`branding/`](branding/).

## License

[MIT](LICENSE)
