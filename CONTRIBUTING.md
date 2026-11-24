# Contributing to Meshboard

Thanks for helping. Meshboard is a peer-to-peer whiteboard with no server: a static site built
with Vite and strict TypeScript, a [Yjs](https://yjs.dev) document for the board,
[Trystero](https://github.com/dmotz/trystero) for peer-to-peer and IndexedDB for the local copy.
Every change has to keep it that way: no backend, no accounts, nothing to pay for.

- Found a bug or have an idea? [Open an issue](https://github.com/AndrianLeah/meshboard/issues/new/choose)
  first for anything bigger than a small fix, so we can agree on the approach.
- Found a security problem? Don't open an issue: follow [SECURITY.md](SECURITY.md).
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need Node 22.18 or later (the version is in [`.nvmrc`](.nvmrc)): Node runs the TypeScript
tests directly, without a build step.

```bash
nvm use            # or install Node 22.18+ any other way
npm ci             # exact versions from package-lock.json
npm run dev        # http://localhost:5173
```

To try two people on one machine, open both `http://localhost:5173` and `http://127.0.0.1:5173` (or
a private window): each gets its own name and storage.

The FigCraft mockup and its PNG sheets in [`mockup/`](mockup/) are stored with Git LFS. You only
need them for design work: run `git lfs install` and `git lfs pull` once.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run check` | Everything CI checks before the build: ESLint, Prettier, the three tsconfigs and the unit tests with coverage thresholds. Run it before every push |
| `npm test` | Unit tests only (`node --test` on `test/*.test.ts`), fast enough to keep running while you work |
| `npm run test:coverage` | The same, failing below 85% of lines, 80% of branches or 75% of functions in `src/` |
| `npm run test:e2e` | [Playwright](https://playwright.dev) tests in [`e2e/`](e2e/) on the production build, desktop and phone |
| `npm run tokens` | Regenerates `src/styles/tokens.css` from `mockup/tokens/variables.css` after the design tokens change in FigCraft. Never edit `tokens.css` by hand |
| `npm run format` | Prettier, when `check` complains about formatting |
| `npm run build` | Production build in `dist/`, service worker included |

For the end-to-end tests, either run `npx playwright install chromium` once, or use the Chrome you
already have:

```bash
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

The end-to-end tests stay off the network. Peer-to-peer is covered by the unit tests, which sync
stores through an in-memory room ([`test/sync.test.ts`](test/sync.test.ts)).

## Where things live

| Folder | What it holds |
| --- | --- |
| [`src/core/`](src/core/) | The board model on Yjs, item schema and sanitising, geometry, clipboard, import and export. **No DOM**: it must run in Node, so it imports nothing from the folders below |
| [`src/sync/`](src/sync/) | The IndexedDB copy, the peer-to-peer transport (Trystero) and presence. Everything goes through the small `RoomLike` interface in `room.ts`, so tests can use an in-memory room |
| [`src/board/`](src/board/) | The canvas: view (pan, zoom), renderers, overlay, one file per tool, and the actions the commands call |
| [`src/commands/`](src/commands/) | Every action by id, and the one shortcut table behind keys, tooltips and the shortcuts panel |
| [`src/ui/`](src/ui/) | Toolbar, context bar, menus, emoji picker. The design system's primitives are in [`src/ui/ds/`](src/ui/ds/) and its styles in [`src/styles/ds/`](src/styles/ds/) |
| [`src/pages/`](src/pages/) | The home screen and the board screen, which put the pieces together |
| [`src/app/`](src/app/) | The install prompt and the offline service worker |

Untrusted data (imported files, the clipboard, anything from a peer) is normalised in
[`src/core/schema.ts`](src/core/schema.ts). If you add an item field, add it there too, with
limits, and test it in [`test/schema.test.ts`](test/schema.test.ts).

## House rules

- **Strict TypeScript.** No `any`, no `@ts-ignore`; type what comes from outside as `unknown` and
  narrow it. `npm run typecheck` must pass for the app, the service worker and the tests.
- **Use the design system.** Build controls with the primitives in `src/ui/ds/` (`h`, `button`,
  `iconButton`, `openPopover`, `toast`…) and style them with the tokens and the classes in
  `src/styles/ds/`. No one-off styles, raw colours or pixel values in components: if something is
  missing, add it to the design system (and to the mockup) first.
- **Everything in English:** code, comments, UI text, commit messages, issues and pull requests.
- **Tests for new behaviour.** Logic gets unit tests in `test/`; a change people can see on the
  board gets an end-to-end test in `e2e/` when it's practical. Bug fixes come with a test that
  fails without the fix.
- **Keep it serverless.** No new network services, analytics or trackers. New dependencies need a
  good reason, because everything ships to every browser.

## Pull requests

`main` only accepts pull requests: a repository ruleset blocks direct pushes and force pushes.
Every pull request runs [CI](.github/workflows/ci.yml) (`check`, the build and the end-to-end
tests), and it merges only when CI is green. `main` then deploys to GitHub Pages after the same
checks.

1. Branch from `main` with a prefix that says what the change is:
   - `feat/…` for something new (`feat/frame-colors`),
   - `fix/…` for a bug (`fix/arrow-after-undo`),
   - `chore/…` for tooling, dependencies and docs (`chore/playwright-update`).
2. Keep each pull request to one change, with commit messages in the imperative
   ("Add frame colours", not "Added…").
3. Run `npm run check`, and `npm run test:e2e` if the interface changed.
4. Open the pull request and fill in the template. Add screenshots for visible changes, and update
   the README if behaviour or setup changed.
