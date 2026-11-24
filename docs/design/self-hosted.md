# Self-hosted Meshboard

**Status:** steps 1 to 4 built; running it is in [the self-hosting guide](../self-hosting.md) ·
**Written:** 24 November 2026

How a team or a company could run Meshboard on its own server: boards kept in a database, people
signing in with the accounts they already have, and their other systems able to read and react to
boards. The public site stays as it is: peer to peer, serverless, without accounts.

## Why

Peer to peer works without anyone running anything, but it has limits that matter most to teams:

- **A board exists only in browsers.** Opening a link when nobody else with the board is online
  shows an empty board.
- **Some networks can't connect directly.** On mobile data and office networks peers often can't
  reach each other without a TURN relay (see
  [Optional: a relay for strict networks](../../README.md#optional-a-relay-for-strict-networks)).
- **The link is the only access control.** There are no accounts, owners or read-only members,
  and a name on the board is not an identity.
- **Introductions go through public relays,** which are run by third parties. That's fine for the
  public site, but many companies won't allow it.

A company that already has a sign-in service and a database wants boards that are always there,
sign-in with existing accounts, data on its own servers, and a way to connect boards to its other
tools.

## Goals

- **Running in minutes:** one container, configured with environment variables, with a working
  default (SQLite, no sign-in) and no code for the common setups.
- **Sign-in is the only touch point:** Meshboard keeps everything in a database of its own and needs
  nothing from your systems except sign-in (OIDC, an SSO gateway, or an in-house service). It's
  never given access to your other databases.
- **Open to other systems, if you want:** an API with tokens and signed webhooks, both unused until
  you set them up.
- **One app for both modes:** the same build runs on GitHub Pages and on the server.
- **Still local-first:** boards open instantly from the browser's copy and can be edited offline.

## Not in scope (for now)

- A hosted Meshboard service.
- End-to-end encryption in server mode: the server reads boards (see [Security](#security)).
- Several organisations on one server: one deployment serves one organisation.
- Accounts managed by Meshboard (passwords, sign-up): people come from the sign-in service.
- Boards that are both peer to peer and on a server: a board belongs to one mode.

## The two modes

|                                    | Public site (today)                        | Self-hosted                                        |
| ---------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| Where boards live                  | In the browsers of the people who use them | In the server's database, plus a copy in browsers  |
| Opening a board nobody else has open | Empty until someone joins                | Loads from the server                              |
| Who you are                        | A name you type                            | Your account from the sign-in service              |
| Who can open a board               | Anyone with the link                       | Owners, members by role, or the whole organisation |
| How edits travel                   | WebRTC between browsers, via Nostr relays  | A WebSocket to the server                          |
| Who can read a board               | The people on it                           | The people on it, and the server's operators       |
| What to run                        | Static files                               | One container, with a database of its own          |

## Overview

```mermaid
flowchart LR
  B["Browser<br/>same app, local copy"] <-->|"HTTPS and WebSocket"| S
  subgraph S["Meshboard server, one container"]
    APP["App files and /config.json"]
    SYNC["Live sync (Hocuspocus)"]
    API["Boards API and webhooks"]
    AUTH["Sign-in adapter"]
    STORE["Storage adapter"]
  end
  AUTH --> IDP["Your sign-in service"]
  STORE --> DB[("Meshboard's own database<br/>SQLite or Postgres")]
  BE["Your backend (optional)"] -.->|"API calls"| API
  API -.->|"webhooks"| BE
```

The server serves the app, keeps boards in sync over a WebSocket, saves them in its own database,
identifies people through a sign-in adapter, and offers an API and webhooks. Sign-in is the only
place it reaches into your systems; the API and webhooks are there for your systems to reach
Meshboard, and they do nothing until you set them up. Each adapter
is picked with an environment variable.

## Decisions

### 1. One app; the mode is chosen when it loads

On startup the app fetches `./config.json`. The server answers it; GitHub Pages and other static
hosts answer 404, and the app runs peer to peer as today. One build and one release serve both
modes, and nobody hosting Meshboard has to rebuild it.

```json
{
  "mode": "server",
  "auth": { "kind": "oidc", "loginUrl": "/auth/login", "logoutUrl": "/auth/logout" }
}
```

The service worker fetches `config.json` network-first, with the last copy as the offline
fallback, the same way it treats the page.

_Considered instead:_ build-time settings, as the TURN relays use. That would make everyone who
hosts Meshboard build it themselves.

### 2. Sync runs on Hocuspocus

[Hocuspocus](https://github.com/ueberdosis/hocuspocus) is a Yjs WebSocket server, MIT-licensed
and maintained by Tiptap (4.9 at the time of writing). A board is already a Yjs document, so its
format doesn't change, and a board exported from the public site imports as it is. Hocuspocus
already has what this design needs:

- `onAuthenticate`, which sees the request headers (the session cookie) and can make a connection
  read-only;
- `onLoadDocument` and `onStoreDocument` with debounced saving (`debounce`, `maxDebounce`), and a
  Database extension that reduces storage to a `fetch` and a `store` function;
- `openDirectConnection`, to edit a board from the server (the API's import);
- a Redis extension for running several instances.

The app uses `@hocuspocus/provider`, and presence travels as Yjs awareness.

_Considered instead:_

- **The server as a peer that never leaves**, speaking today's room protocol over a WebSocket
  (`RoomLike` in `src/sync/room.ts`). It's the smallest change in the app, since `p2p.ts` and
  `presence.ts` would stay as they are, but we'd be writing and maintaining our own sync server:
  reconnection, authentication, limits, scaling.
- **y-websocket's server:** simpler, with fewer of the hooks above.
- **y-sweet:** a good fit for S3 storage, but it adds a Rust service and a second runtime to the
  simplest setup.

### 3. In the app, `connect()` is the seam

`connect(store, token, options)` in [`src/sync/index.ts`](../../src/sync/index.ts) returns
`{ ready, presence, peerCount, onError, destroy }`, and the board page only uses that. Server mode
adds `src/sync/server.ts` with the same shape:

- `ready` still resolves when the browser's copy is loaded, so a board opens instantly and then
  catches up with the server.
- `presence` is backed by awareness and keeps the `Presence` API (`peers`, `onPeers`, `onMove`),
  so cursors and avatars don't change.
- `onError` reports server cases (`unauthorized`, `forbidden`, `offline`), and the join notice
  gets matching states: connecting, no access, offline.

Around it:

- **Board references.** `BoardToken` (`roomId` and `secret`) becomes a union:
  `{ kind: 'p2p', roomId, secret } | { kind: 'server', id }`.
- **Links.** Server boards use `https://board.example.com/b/<id>`, with no secret: the server
  checks access, and it serves the app for `/b/*`. Peer-to-peer links don't change.
- **Home screen.** A dashboard of the boards you can open, from `GET /api/v1/boards`, so it's the
  same on every device: views in the sidebar (all, recent, starred, shared with me, trash), the
  groups from the sign-in service, and filters by owner, access, group and last edit. The recent
  boards in localStorage stay for peer-to-peer mode. See the mockup below, or the **Dashboard**
  page of [`mockup/meshboard-board-ui.figcraft`](../../mockup/meshboard-board-ui.figcraft).

  ![The dashboard of a signed-in user, with the owner filter open](dashboard-mockup.png)
- **Name.** It comes from the sign-in service; the name prompt only appears with `AUTH=none`.
- **No peer to peer in server mode.** Each transport is loaded with a dynamic `import()`, so the
  public site never downloads the server code and a server deployment never contacts Nostr relays.

### 4. A board stays one Yjs document

The server stores each board as one binary (`Y.encodeStateAsUpdate`), saved a couple of seconds
after the last edit, at least every few seconds while people are editing, and when the board
closes. Its title and last change go into the `boards` row, for lists and search.

Items are not copied into rows of their own. Yjs is what merges concurrent edits, so a relational
copy would be a second source of truth that drifts. Other systems read boards as JSON in the
existing export format ([`src/core/transfer.ts`](../../src/core/transfer.ts)). The server builds
it with `src/core`, which by the house rules has no DOM and runs in Node.

Incoming edits are handled as today: every browser cleans the items it receives with
`sanitizeItem`, and the export does the same. The server adds limits of its own: message size,
board size, and read-only connections can't send updates.

### 5. Sign-in adapters

Every adapter turns a request into an identity, or nothing:

```ts
interface Identity {
  id: string // stable, from your sign-in service
  name: string
  email?: string
  avatarUrl?: string
  groups?: string[]
}
```

Meshboard never stores passwords. Its `users` table is a cache keyed by the sign-in service's id.

| `AUTH`    | For                                                                  | Work on your side            |
| --------- | -------------------------------------------------------------------- | ---------------------------- |
| `none`    | Small teams on a trusted network: people type a name, as today       | None                         |
| `oidc`    | Okta, Entra ID, Google Workspace, Keycloak, Auth0, Authentik, Zitadel | Register one app             |
| `proxy`   | An SSO gateway already in front of internal tools                    | None                         |
| `webhook` | An in-house sign-in service                                          | One endpoint (see below)     |

- **`none`:** an anonymous id and the typed name, with a session like any other. Anyone who can
  reach the server can sign in, and sees every board shared with everyone.
- **`oidc`:** authorisation code flow with PKCE, using
  [openid-client](https://github.com/panva/openid-client) (MIT), on `/auth/login`,
  `/auth/callback` and `/auth/logout`. `sub` becomes the id; `name`, `email` and `picture` fill in
  the rest, and `OIDC_GROUPS_CLAIM` names a claim with groups. A sign-in service that only speaks
  SAML can sit behind a broker such as Keycloak, or behind the gateway.
- **`proxy`:** a gateway such as oauth2-proxy, Pomerium, Cloudflare Access or nginx `auth_request`
  signs people in and passes headers (`X-Forwarded-User`; email, name and groups only when
  configured, since the gateway must set or strip each one).
  Meshboard trusts them only from `TRUSTED_PROXIES`, and the server must not be reachable around
  the gateway.
- **`webhook`:** Meshboard asks your service who the request belongs to. It forwards only the
  `Cookie` and `Authorization` headers, signs the call, and keeps the answer for a minute.

  ```http
  POST /meshboard/whoami HTTP/1.1
  Host: auth.internal.example.com
  Content-Type: application/json
  X-Meshboard-Signature: sha256=5f3c…

  {"headers":{"cookie":"session=…","authorization":"Bearer …"}}
  ```

  Your service answers `200` with an `Identity`, or `401`:

  ```json
  { "id": "u_1842", "name": "Anna", "email": "anna@example.com", "groups": ["design"] }
  ```

  Your session cookie has to reach Meshboard, so it works when Meshboard runs on a subdomain your
  cookie covers (`board.example.com` under `.example.com`). Otherwise your app links to Meshboard
  with a short-lived `?token=`, which Meshboard checks through the same webhook once and swaps for
  its own session.

After any adapter, Meshboard keeps its own session: an `HttpOnly`, `Secure`, `SameSite=Lax` cookie
whose id is stored hashed. The WebSocket is same-origin, so the cookie reaches `onAuthenticate`,
which also checks the `Origin` header against `MESHBOARD_URL`.

### 6. Access

- **Roles on a board:** owner, editor, viewer. Viewers get read-only connections, enforced by the
  server.
- **General access on a board:** members only, everyone in the organisation can view, or everyone
  in the organisation can edit. `DEFAULT_ACCESS` sets it for new boards (default: everyone can
  edit, as an internal tool usually wants).
- **Groups:** when the sign-in service provides groups, a group can be a member (`group:design`).
- **Admins:** `ADMIN_EMAILS` or `ADMIN_GROUP` can see every board and hand a board to a new owner
  when someone leaves.
- **Removing someone** closes their open connections to the board.

Later, an access webhook could let your backend decide (`{ userId, boardId }` in, a role out), to
tie boards to your own projects and teams.

### 7. A database of its own

Meshboard keeps its data in a database that only it uses, and it's never given access to yours:

- **A smaller blast radius.** A bug in Meshboard, or someone who takes it over, can't read or change
  your other data: its credentials open its own tables and nothing else.
- **Simpler to run.** Its migrations, backups and upgrades touch only its own database, and
  removing Meshboard means removing that database.
- **One link to your data:** the user id from your sign-in service. Other systems read Meshboard
  through its API, not its tables.

The server talks to the database through [Kysely](https://kysely.dev) (MIT), so SQLite and
Postgres share one code base, and MySQL or SQL Server could follow.

- **SQLite (default):** a file in the `/data` volume. Nothing to set up; one instance.
- **Postgres:** `DATABASE_URL` pointing to a database only Meshboard uses, with a user that owns it
  and has no rights anywhere else. It can live on a Postgres server you already run, or on its own.
  Migrations run at startup under a lock.

```mermaid
erDiagram
  users ||--o{ boards : owns
  boards ||--o{ board_members : has
  boards ||--|| board_state : "is stored in"
  users ||--o{ sessions : has
  users ||--o{ api_tokens : creates
  users {
    text id PK "from the sign-in service"
    text name
    text email
    text avatar_url
    timestamp last_seen_at
  }
  boards {
    text id PK "random, in links"
    text title
    text owner_id FK
    text access "members, org_view, org_edit"
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at "in the trash"
  }
  board_members {
    text board_id PK
    text principal PK "user id or group:name"
    text role "owner, editor, viewer"
  }
  board_state {
    text board_id PK
    blob state "the Yjs document"
    int size_bytes
    timestamp updated_at
  }
  sessions {
    text id_hash PK
    text user_id FK
    timestamp expires_at
  }
  api_tokens {
    text id PK
    text owner_id FK
    text token_hash
    text scopes
    timestamp expires_at
    timestamp last_used_at
  }
```

Deleted boards go to a trash and are purged after 30 days.

### 8. API and webhooks

A JSON API under `/api/v1`. The app uses it with its session cookie. Scripts and your backend use
`Authorization: Bearer <token>`, with tokens that are shown once, stored hashed, scoped and
expiring; until someone creates a token, nothing outside the app can call it.

| Request                                             | What it does                                                    |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/v1/me`                                    | The signed-in person                                            |
| `GET /api/v1/boards`                                | Boards you can open, with search and paging                     |
| `POST /api/v1/boards`                               | Creates a board, optionally from a board file used as a template |
| `GET`, `PATCH`, `DELETE /api/v1/boards/:id`         | A board's details, title and access; delete moves it to the trash |
| `GET /api/v1/boards/:id/export`                     | The board as a board file (JSON)                                |
| `POST /api/v1/boards/:id/import`                    | Adds items from a board file; open tabs see them arrive live    |
| `GET`, `PUT`, `DELETE /api/v1/boards/:id/members/…` | Members and their roles                                         |
| `GET /healthz`, `GET /readyz`                       | Health checks for Docker and Kubernetes                         |

`WEBHOOK_URL` receives `board.created`, `board.updated` (at most once a minute per board),
`board.deleted`, `member.added` and `member.removed`:

```json
{
  "id": "evt_9f2c…",
  "type": "board.updated",
  "occurredAt": "2026-11-24T15:04:05Z",
  "board": { "id": "q3J8…", "title": "Sprint 42 retro", "url": "https://board.example.com/b/q3J8…" },
  "actor": { "id": "u_1842", "name": "Anna" }
}
```

Each delivery is signed (`X-Meshboard-Signature`, an HMAC-SHA256 of the body with
`WEBHOOK_SECRET`) and retried with backoff. Deliveries can repeat, so receivers should use the event
`id` to skip duplicates.

### 9. Packaging and running it

The app stays at the root of the repository; the server is a second npm workspace next to it:

```text
server/
  src/
    main.ts         starts everything; cli.ts has the admin commands
    app.ts          the HTTP server: app, config.json, sign-in, API, WebSocket
    config.ts       reads and checks the environment
    auth.ts         the four ways to sign in, sessions and API tokens
    access.ts       who can do what on a board
    boards.ts       listing, sharing, the trash, export and import
    sync.ts         Hocuspocus, saving, read-only viewers
    db.ts           SQLite (node:sqlite) or Postgres, and the migrations
    api.ts          /api/v1; webhooks.ts sends events
  test/             the server over real HTTP and WebSockets, a fake OpenID provider
deploy/
  compose.yml           SQLite, no sign-in
  compose.postgres.yml  Postgres and OIDC
Dockerfile
docs/self-hosting.md    the guide for people running it
```

- **One image,** `ghcr.io/andrianleah/meshboard`, holds the app and the server. It's built in
  stages, runs as a non-root user on port 8080, and keeps its data in `/data`. Releases (`v*` tags)
  publish it for amd64 and arm64.
- **Configuration is checked at startup.** A missing or wrong setting stops the server with a
  message that names it.
- **Logs** go to standard output as JSON lines, and never include board content.
- **Backups** are the database's: a copy of the SQLite file, or your usual Postgres backups.
- **Upgrades** run migrations at startup, forward only.
- **Several instances** need the Redis extension; one instance is enough for most companies.

The simplest start, once the image exists:

```text
docker run -p 8080:8080 -v meshboard:/data -e MESHBOARD_URL=http://localhost:8080 ghcr.io/andrianleah/meshboard
```

## Configuration

The main settings; the full list is in [the self-hosting guide](../self-hosting.md#settings).

| Variable                                            | Default                                  | What it's for                                                         |
| --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `MESHBOARD_URL`                                     | required                                 | The public address: links, sign-in redirects and the `Origin` check   |
| `PORT`                                              | `8080`                                   |                                                                       |
| `DATA_DIR`                                          | `/data`                                  | The SQLite file and the generated session secret                      |
| `DATABASE_URL`                                      | empty: SQLite                            | A Postgres database that only Meshboard uses                                          |
| `SESSION_SECRET`                                    | generated into `DATA_DIR` on first start | Signs cookies; set it when running several instances                  |
| `AUTH`                                              | `none`                                   | `none`, `oidc`, `proxy` or `webhook`                                  |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` |                                        | For `oidc`                                                            |
| `OIDC_SCOPES`, `OIDC_GROUPS_CLAIM`                  | `openid profile email`, none             |                                                                       |
| `PROXY_USER_HEADER`, `PROXY_EMAIL_HEADER`, `PROXY_NAME_HEADER` | `X-Forwarded-User`, none, none | For `proxy`                                               |
| `TRUSTED_PROXIES`                                   | required with `proxy`                    | Addresses (CIDR) allowed to set those headers                         |
| `AUTH_WEBHOOK_URL`, `AUTH_WEBHOOK_SECRET`           |                                          | For `webhook`                                                         |
| `ADMIN_EMAILS`, `ADMIN_GROUP`                       | none                                     | Who can see every board                                               |
| `DEFAULT_ACCESS`                                    | `org_edit`                               | General access for new boards: `members`, `org_view` or `org_edit`    |
| `WEBHOOK_URL`, `WEBHOOK_SECRET`                     | none                                     | Where events go, and the key that signs them                          |
| `MAX_BOARD_BYTES`                                   | `20000000`                               | The largest board the server keeps                                    |

A company setup with Postgres and OIDC:

```yaml
services:
  meshboard:
    image: ghcr.io/andrianleah/meshboard
    ports: ['8080:8080']
    volumes: ['meshboard:/data']
    environment:
      MESHBOARD_URL: https://board.example.com
      DATABASE_URL: postgres://meshboard:${DB_PASSWORD}@db.internal.example.com/meshboard
      AUTH: oidc
      OIDC_ISSUER: https://login.example.com
      OIDC_CLIENT_ID: meshboard
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
      ADMIN_GROUP: it
volumes:
  meshboard:
```

## Security

Server mode changes what Meshboard promises, and [SECURITY.md](../../SECURITY.md) gets a section
for it when the server ships.

- **The server can read boards,** and so can its operators. That's what makes backups, export and
  the API possible. Encryption at rest is the database's or the disk's job.
- **Its own database, and nothing else.** Meshboard's database user has rights only on Meshboard's
  database, and the server never holds credentials for your other databases. Sign-in is the only
  call it makes into your systems.
- **TLS** ends at your reverse proxy or ingress. In production `MESHBOARD_URL` must be `https`,
  and cookies are `Secure`.
- **Sessions** are `HttpOnly`, `SameSite=Lax` cookies whose ids are stored hashed. They're renewed
  at sign-in and revoked at sign-out.
- **Requests that change data** need a JSON body and an `Origin` that matches `MESHBOARD_URL`;
  WebSocket connections are checked against the same `Origin`.
- **Proxy headers** are trusted only from `TRUSTED_PROXIES`.
- **Webhooks** are signed both ways. Their URLs come only from the server's settings, never from
  users, so the server can't be pointed at internal addresses.
- **Limits** cap message size, board size and API requests per client.
- **Content from browsers stays untrusted:** browsers clean items with `sanitizeItem`, the export
  does too, and the server sends a strict Content-Security-Policy.

## The house rules

[CONTRIBUTING.md](../../CONTRIBUTING.md) says "Keep it serverless". With this design the rule
becomes: the app stays serverless by default, so the public build talks to no service of ours;
server code lives in `server/` and is opt-in; and the app loads the server's sync code only in
server mode. The rule changes in the pull request that adds the server.

## Steps

Each step is one pull request and leaves `main` working.

1. **Groundwork (app only).** `config.json`, board references, and `connect()` picking the
   transport. Nothing visible changes. _Done when_ peer to peer works as today, with unit tests for
   the config and the choice of transport.
2. **The server, first version.** `server/` with Hocuspocus and SQLite, `AUTH=none`, the board
   list, the Docker image, a Compose file and the self-hosting guide. _Done when_ an end-to-end test
   creates a board in one browser, closes it, and opens it in another browser with the content
   there.
3. **Sign-in and access.** OIDC and the gateway, sessions, owners, members and roles, read-only
   viewers, and a share dialog for server mode. _Done when_ tests sign in through an OpenID
   provider and a viewer can't edit. (Built with a fake provider in the server's tests rather than
   Keycloak in Compose: the same flow, without a heavy dependency in CI.)
4. **Integrations.** Postgres, the sign-in webhook, and the optional API tokens, API and outgoing
   webhooks.
   _Done when_ CI runs the server's tests against Postgres and the webhook signatures are tested.
5. **Later:**
   - images on boards (next, below);
   - embedding Meshboard in other apps, with signed tokens;
   - the access webhook;
   - several instances through Redis;
   - a Helm chart for Kubernetes;
   - moving a board from the public site to a server;
   - MySQL and SQL Server;
   - metrics.

If a company's sign-in is in-house, step 4's sign-in webhook can come before OIDC in step 3.

## Next: images

An image on a board is a URL: Meshboard never stores files. To add one from a file, the app sends
it to an upload endpoint the deployment configures (the organisation's own storage), and a
converter turns that endpoint's answer into Meshboard's image format: at least the URL, and the
size when the answer has it. Pasting an image's URL needs no endpoint. The public site gets images
only if whoever hosts it sets an upload endpoint, as with the TURN relay. Images are allowed only
from the configured origins, so the Content-Security-Policy stays narrow.

## Open questions

- **Guests from outside the organisation:** should a board be shareable with someone who has no
  account (a view-only guest link, for example)?
- **Peer-to-peer boards on a server deployment:** worth allowing for quick, throwaway boards, or
  is one mode per deployment clearer?
- **SQLite driver** (decided): Node's built-in `node:sqlite`, behind Kysely's SQLite dialect. No
  native module to build, and the image stays small; it's still marked experimental in Node 22, so
  the server hides that warning and the tests cover it.
- **History:** keeping Yjs snapshots so a board can be rolled back. It isn't needed for the first
  version, but the storage shouldn't rule it out.
