# Meshboard — board interface mockup (v2)

A redesign of the board's core interface: same product, but with the usability patterns and the keyboard
shortcuts that established whiteboard tools share, so people who already use one feel at home from the first minute. Nothing in `src/`
changes until this mockup is approved.

| File | What it holds | In git |
| --- | --- | --- |
| `meshboard-board-ui.figcraft` | FigCraft document, 2 pages: **Foundations** (tokens, icons, components and states) and **Board** (6 screens) | Yes, through Git LFS |
| `tokens/` | The document's variables (Theme, Spacing, Radius, Size) exported from FigCraft: `variables.json` re-imports, `variables.css` is the CSS version | Yes |
| `png/foundations.png` | The Foundations page as one sheet | Yes, through Git LFS |
| `png/` (the rest) | One PNG per screen (desktop at 1×, phone at 2×) | No: re-export them from the FigCraft file |

To open it: FigCraft → *Open* → `mockup/meshboard-board-ui.figcraft`. After a clone run `git lfs install` and
`git lfs pull` to get the real files instead of their pointers. The font is **Inter** (SIL OFL).

**From design to code.** Colours, spacing, radii and sizes live only as variables. If one changes in FigCraft,
re-export `tokens/` and the app picks them up from `src/styles/tokens.css` (generated from
`tokens/variables.css`, see *Code structure*).

---

## 1. What is wrong today, and the common fix

An audit of the current board (v1, `src/board.js` + `src/app.js`), item by item. Every row names the
established whiteboard pattern the fix borrows.

| # | Today (v1) | Why it hurts | Common pattern | v2 |
| --- | --- | --- | --- | --- |
| 1 | Toolbar of bare icons, `title` tooltips, black fill on the active tool | Shortcuts are invisible; the active state is heavier than the content | Left toolbar, tooltips with the key, soft active state | Grouped tools (navigate / create), dark tooltip with a **key chip**, active = `accent/tint` + blue icon |
| 2 | Undo/redo mixed with the tools | Two different jobs in one bar | Undo/redo in their own panel, bottom-left | **History** panel bottom-left |
| 3 | Colour bar fixed at the top centre, the same for every type | Long mouse travel from the selection; options that don't apply | Context toolbar floating **above the selection** | **Context bar** follows the selection, shows only what fits the type (colour, order, duplicate, lock, delete, more) |
| 4 | No right-click | Common actions need the keyboard or the far bar | Context menu with shortcuts | **Context menu**: copy, paste, duplicate, order, group, lock, delete — each with its key |
| 5 | Sticky text 16 px, top-left, in a mostly empty square | Hard to read when zoomed out; boards look sparse | Text centred and **auto-fitted** to the note | Centred, Inter Medium, auto-fit 12–28 px |
| 6 | 👍/👎 always visible, with zeros | Noise on every note; two fixed opinions only | **Reactions**: any emoji, only the ones in use are shown | Reaction chips (`🎉 2`), "mine" in accent; **emoji picker** with search, groups and frequent ones |
| 7 | Making a row of notes = N, click, N, click… | Slow brainstorming | **Quick-add** "+" buttons around a selected sticky | "+" on three sides creates the next note there, same colour, ready to type |
| 8 | Connectors only from the arrow tool | Mode switching to link two ideas | **Connection dots** on hover; drag from a dot | Dots on hover, drag to a target (target highlighted), end points re-attachable |
| 9 | Dragging has no alignment help | Boards get messy | **Smart guides** | Magenta guides (`guide`) on edges and centres, snap within 6 px |
| 10 | 4 square handles, no edge handles | Resizing one side is impossible | 8 handles, proportional for stickies | Round handles (corners on stickies, all 8 on shapes) |
| 11 | No copy/paste, no ⌥-drag, no lock, no groups | Basic editing missing | ⌘C/⌘V, ⌥-drag, lock, group | All of them, with the usual keys |
| 12 | Columns faked with rectangles + separate text | Moving a column leaves its notes behind | **Frames** with a title that carry their content | Frames (F): white sheet, title above, move with what's inside; marquee starts inside them |
| 13 | No freehand | Can't circle or underline | Pen and eraser | Pen (P) and eraser (E) for quick marks |
| 14 | Wheel always pans; ⌘± zooms the browser | Mouse users can't zoom naturally; page zoom breaks the layout | Mouse wheel zooms, trackpad pans/pinches; ⌘± zoom the board | Input detection: mouse wheel → zoom at cursor, trackpad → pan, pinch → zoom; ⌘+ ⌘− ⌘0 handled by the board |
| 15 | Shortcuts listed in a dialog hidden in a menu, non-standard keys | Nothing transfers from other whiteboards | The usual keys, panel on **?** | The usual whiteboard keys (table below), panel on **?**/F1 and from the zoom bar's help button |
| 16 | System font | Renders differently on each OS | One typeface | **Inter**, bundled |

## 2. Screens (page **Board**)

| Frame | Shows |
| --- | --- |
| `board-desktop-select` | A retro with three frames; one sticky selected: handles, quick-add "+", **context bar** above it; teammates' cursors; top bars, toolbar, history, zoom controls |
| `board-desktop-react` | Hover on a sticky shows **add reaction**; the **emoji picker** is open with the search "party" |
| `board-desktop-connect` | **Shapes** flyout open (S active), tooltip "Frame F"; **connection dots** on a shape and a connector being dragged to a highlighted target; **smart guides** while a sticky is moved |
| `board-desktop-menu` | Multi-selection (group box + per-item outlines) and the right-click **context menu** |
| `board-desktop-shortcuts` | The **Keyboard shortcuts** panel over the board |
| `board-phone` | 390 × 844: compact top bar, context bar, history above the **bottom toolbar** |

## 3. Foundations

**One colour, one meaning** (collection **Theme**):

| Token | Value | Only for |
| --- | --- | --- |
| `accent` | `#3D5AF1` | What you are acting on: selection, active tool, primary action (Share), focus, your own reactions |
| `accent/tint` | `#EAEEFE` | Active tool background, "mine" reaction chip |
| `guide` | `#F03E9B` | Smart guides while dragging — never anything else |
| `danger` | `#E03A3E` | Delete and errors |
| `online` | `#2F9E44` | Presence |
| `ink` | `#141925` | Brand tile, tooltips |
| `canvas`, `canvas/dot` | `#F5F5F2`, `#D3D3CC` | The board and its dot grid |
| `surface`, `surface/hover`, `surface/pressed`, `line`, `line/strong` | — | Panels, menus, their states and borders |
| `text/primary`, `text/secondary`, `text/tertiary` | — | All text and icons |
| `note/*` + `stroke/*` | 8 pairs | Sticky fills; shape outlines, text, connectors and pen in the matching stroke |

**Spacing** 4 pt grid (`space/1`–`space/8`: 4–32). **Radius**: 6 controls, 8 buttons, 12 panels, 16 dialogs,
capsule for chips. **Sizes**: tool button 40, icon 20, compact control 32, bars 48, handle 10, avatar 28.

**Type** (Inter): dialog title 18 Semi Bold · board title 15 Semi Bold · menus and rows 13 Regular · frame
titles and buttons 13 Medium · tooltips and counts 12 · author, group labels, key chips 11 Medium · sticky
text Medium, auto-fit 12–28, centred.

**Panels** share one recipe: `surface`, 1 px `line`, radius 12, two shadows (1 px tight + 24 px soft).

**Icons**: one 24-grid set of 48 line icons (1.75 stroke, round caps), drawn at 20 in the UI, components in
the file and exported to `src/ui/icons.js` from the same paths.

## 4. Interaction spec

**Selection.** Click selects; ⇧/⌘-click adds; drag on empty canvas (or inside a frame) draws a marquee
(frames are selected only when fully inside it, or by their title). One item: outline + handles (stickies keep
their square, shapes have all 8). Several: a group box plus thin per-item outlines. Locked items show a lock
and can't be moved, resized or deleted until unlocked.

**Context bar** floats 12 px above the selection's box (below it when there's no room), hidden while
dragging. Content by type: colour (palette popover), order (front/back), duplicate, lock, delete, more (= the
context menu). Text items add a size control; connectors add line ends and dashed/solid.

**Quick-add.** With one sticky selected, "+" buttons sit 24 px from its sides (none on the side the context bar
covers). Click: a new sticky of the same size and colour, 24 px away, in edit mode.

**Connectors.** Hovering an item shows four connection dots at its mid-sides; dragging from one draws a
connector; the item under the pointer is highlighted and becomes the target. A selected connector shows its
two end handles: drag to re-attach or free them.

**Smart guides.** While moving, the selection's edges and centre snap to other items' edges and centres within
6 screen px; each match draws a `guide` line across both. Hold ⌘ to move without snapping.

**Reactions** (replace the fixed 👍/👎 votes).
- A note shows only the reactions in use: `emoji + count` chips, yours in `accent`. Hover a chip to see who
  reacted; click it to add or remove yours.
- *Add reaction* (smiley-plus) appears on hover and on the selected note, and with ⌘⇧E. It opens the
  **emoji picker**, anchored to the button.
- The picker follows the one in On Page UI (`OpEmojiPicker`): `emojibase-data` (MIT, data only), loaded the first
  time the picker opens; only the emoji the system can draw (tested once on a canvas); a search over names,
  tags and emoticons across all groups (names starting with the query first); a tab per group; a 9 × 8 grid of
  32 px cells; the 9 emoji you use most in a row below (counted in this browser); arrows move, Enter picks,
  Esc closes.
- Old boards keep their votes: 👍 → `👍`, 👎 → `👎`, migrated when the board loads.

**Navigation.** Mouse wheel zooms at the cursor; trackpad scroll pans, pinch zooms; space-drag, middle-drag and
right-drag pan (a right-click without moving opens the context menu). Arrow keys move the selection, or the
canvas when nothing is selected.

**Phone.** Tools in a horizontal bar at the bottom (safe area respected), history above it on the left, a
compact top bar (title, people, a Share icon button); pinch to zoom, one-finger drag on empty canvas pans.

## 5. Keyboard shortcuts

The keys most whiteboard tools share (⌘ is Ctrl on Windows and Linux). One table in the code drives the handler, the
tooltips and the shortcuts panel, so they can't drift apart.

| Action | Keys | Notes |
| --- | --- | --- |
| Select · hand | V · H | |
| Sticky note · text | N · T | |
| Shapes · rectangle · oval | S · R · O | S opens the shapes flyout |
| Connection line | L | was A in v1 |
| Pen · eraser | P · E | new |
| Frame | F | new |
| Undo · redo | ⌘Z · ⌘⇧Z | |
| Copy · cut · paste | ⌘C · ⌘X · ⌘V | new; pasting plain text makes one sticky per line |
| Duplicate | ⌘D · ⌥-drag · ⌥+arrows | ⌥+arrows duplicates next to the item |
| Select all | ⌘A | |
| Edit · stop editing | Enter · Esc | Esc also deselects and returns to Select |
| Delete | ⌫ / Delete | |
| Group · ungroup | ⌘G · ⌘⇧G | new |
| Lock · unlock | ⌘⇧L | new |
| Bring to front · forward | PgUp · ⇧PgUp | |
| Send to back · backward | PgDn · ⇧PgDn | |
| Zoom in · out · 100% | ⌘+ · ⌘− · ⌘0 | the board's zoom, not the browser's |
| Zoom to fit · to selection | ⇧1 · ⇧2 (also ⌥1 · ⌥2) | ⌘1 is left alone: browsers keep it for tabs |
| Pan | Space + drag · arrows | |
| Toggle grid | G | |
| Add reaction | ⌘⇧E | ours: there is no common key for it |
| Shortcuts panel | ? · F1 | |

Not in this round: comments (C), cards (D), minimap (M), command palette (⌘K), search (⌘F),
text formatting (⌘B/I/U).

## 6. Code structure (for the implementation)

The board grows from 5 tools to 10 and gains menus, popovers and a picker: one file per responsibility, the
data model free of DOM, and a single command registry behind every button, menu row and key.

```
src/
  main.js                      boot and routing
  styles/
    tokens.css                 generated from mockup/tokens/variables.css (single source of truth)
    base.css  board.css  chrome.css  home.css
  core/                        no DOM: runs in Node tests
    schema.js                  item types, sanitising, migrations (votes → reactions)
    store.js                   Yjs model: items, z-order, groups, lock, reactions, title, users
    clipboard.js               serialise a selection, paste at a point
    transfer.js                export / import files
    geometry.js                bounds, hit tests, connector ends, snapping maths
  sync/
    persistence.js             IndexedDB
    p2p.js                     Trystero transport (updates, state vectors)
    presence.js                cursors and names
  board/                       the canvas, no app chrome
    board.js                   state + render loop + public API
    view.js                    pan/zoom, screen ↔ world, wheel/trackpad detection
    render/                    items.js · connectors.js · overlay.js (selection, handles, quick-add, dots, guides) · cursors.js
    tools/                     select.js · hand.js · note.js · shape.js · text.js · connector.js · pen.js · eraser.js · frame.js
                               (same interface: down / move / up / cancel / cursor)
    text-fit.js                sticky auto-fit
  commands/
    registry.js                command id → { run, enabled, label }
    keymap.js                  the shortcuts table above → command ids
  ui/
    icons.js                   the 48 icons, from the FigCraft paths
    toolbar.js  flyouts.js  history.js  zoom-controls.js  context-bar.js  context-menu.js
    tooltip.js  toast.js  topbar.js  shortcuts-dialog.js
    emoji-picker/              emoji-picker.js · emoji-data.js (lazy emojibase-data, drawable test, frequent)
  pages/
    home.js  board-page.js
test/                          core/*, commands/keymap (no duplicate keys), geometry/snapping
```

New dependencies: `emojibase-data` (emoji data, loaded on demand) and `@fontsource-variable/inter` (the font,
self-hosted). Nothing else.

## 7. Decisions to confirm

1. **Reactions on your own notes.** v1 forbade voting on your own sticky. Whiteboards usually let anyone react to
   anything. Proposal: do the same.
2. **Mouse wheel.** Proposal: auto-detect (mouse wheel zooms, trackpad pans), with a "Scroll to zoom / pan"
   choice in the menu for the odd mouse that is detected wrongly.
3. **Frames.** Clicking inside a frame's empty area draws a marquee instead of selecting the frame (the usual
   behaviour); the frame is selected from its title or with a marquee around it.
4. **Inter bundled** (~100 KB woff2, cached by the service worker) instead of the system font.
5. **Dark theme** stays out of this round; the tokens are ready for a second mode.
