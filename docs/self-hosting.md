# Self-hosting Meshboard

Run Meshboard on your own server: boards are kept in a database of its own, people sign in with the
accounts they already have, and a board is there for whoever opens it, even when nobody else is
online. The design and its reasons are in [design/self-hosted.md](design/self-hosted.md).

The public site (GitHub Pages) doesn't change: it stays peer to peer, without accounts or a server.

## Quick start

```bash
docker run -p 8080:8080 -v meshboard:/data -e MESHBOARD_URL=http://localhost:8080 ghcr.io/andrianleah/meshboard
```

Open <http://localhost:8080>, type your name, and create a board. Data is kept in the `meshboard`
volume (SQLite). Without Docker, from a clone of the repository:

```bash
npm ci && npm run build && MESHBOARD_URL=http://localhost:8080 npm run server
```

For a company, [`deploy/compose.postgres.yml`](../deploy/compose.postgres.yml) runs Meshboard with
its own Postgres and OpenID Connect sign-in. Put it behind your HTTPS reverse proxy.

## What it touches in your systems

Only sign-in. Meshboard keeps everything else in **its own database**: a SQLite file in `/data`, or a
Postgres database that only it uses, with a user that has no rights anywhere else. It never reads
or writes your other databases. The API and outgoing webhooks are there for your systems to reach
Meshboard, and do nothing until you set them up.

## Settings

Environment variables, checked at startup: a missing or wrong one stops the server with a message
naming it (`docker run … meshboard node server/src/cli.ts check-config` checks them on their own).

| Variable                                            | Default                                       | What it's for                                                                                                    |
| --------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `MESHBOARD_URL`                                     | required                                      | The public address, with a path if it's not at the root. Links, sign-in redirects and the Origin check use it   |
| `ORG_NAME`                                          | `your organisation`                           | Shown as "Everyone at …"                                                                                         |
| `PORT`, `HOST`                                      | `8080`, `0.0.0.0`                             |                                                                                                                  |
| `DATA_DIR`                                          | `/data` in the image                          | The SQLite file and the generated session secret                                                                 |
| `DATABASE_URL`                                      | empty: SQLite                                 | `postgres://…` to a database only Meshboard uses                                                                 |
| `SESSION_SECRET`                                    | generated into `DATA_DIR`                     | 32 characters or more. Set it when you run more than one instance                                                |
| `SESSION_DAYS`                                      | `30`                                          | How long a sign-in lasts                                                                                         |
| `AUTH`                                              | `none`                                        | `none`, `oidc`, `proxy` or `webhook` (below)                                                                     |
| `ADMIN_EMAILS`, `ADMIN_GROUP`                       | none                                          | Admins see and manage every board                                                                                |
| `DEFAULT_ACCESS`                                    | `org_edit`                                    | New boards: `members` (only people added), `org_view` or `org_edit`                                              |
| `TRUSTED_PROXIES`                                   | none                                          | Addresses (CIDR) of your reverse proxy or gateway: their `X-Forwarded-For` is used for rate limits               |
| `WEBHOOK_URL`, `WEBHOOK_SECRET`                     | none                                          | Where board events go, and the key that signs them                                                               |
| `MAX_BOARD_BYTES`, `MAX_MESSAGE_BYTES`              | `20000000`, `2000000`                         | The largest board kept, and the largest live-sync message                                                        |
| `ALLOW_HTTP`                                        | `false`                                       | `MESHBOARD_URL` must be https unless it's `localhost`; `true` allows plain http on a private test network only |

## Signing in

**`AUTH=none`.** People type a name. Anyone who can reach the server can sign in, so use it for a
trial or a small team on a private network.

**`AUTH=oidc`.** Okta, Entra ID, Google Workspace, Keycloak, Auth0, Authentik, Zitadel… Register a
web application with the redirect URI `https://<your address>/auth/callback`, then set
`OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. `OIDC_SCOPES` defaults to
`openid profile email`; `OIDC_GROUPS_CLAIM` names the claim that lists someone's groups (for
sharing with a group and `ADMIN_GROUP`). An email the provider marks as not verified is ignored. A
provider that only speaks SAML can sit behind a broker such as Keycloak.

**`AUTH=proxy`.** Your SSO gateway (oauth2-proxy, Pomerium, Cloudflare Access, nginx
`auth_request`…) signs people in and passes who they are in headers. Set `TRUSTED_PROXIES` to the
gateway's addresses: headers from anywhere else are ignored. The headers are `X-Forwarded-User`
(required, a stable id) and `X-Forwarded-Email`; `PROXY_NAME_HEADER` and `PROXY_GROUPS_HEADER`
(comma-separated) are optional, and every name can be changed with the `PROXY_*_HEADER` settings.
Meshboard must not be reachable around the gateway.

**`AUTH=webhook`.** Your own sign-in service tells Meshboard who a request belongs to. Set
`AUTH_WEBHOOK_URL` (https) and `AUTH_WEBHOOK_SECRET` (16 characters or more). Meshboard sends:

```http
POST /meshboard/whoami
Content-Type: application/json
X-Meshboard-Timestamp: 1795536000
X-Meshboard-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>" with the secret>

{"headers":{"cookie":"your_session=…","authorization":"Bearer …"}}
```

It forwards only the `Cookie` (without Meshboard's own) and `Authorization` headers, so your
session cookie must reach Meshboard: run it on a subdomain your cookie covers. Answer `200` with
`{"id": "…", "name": "…", "email": "…", "groups": ["…"]}`, or `401`. Answers are kept for a
minute. Check the signature and reject timestamps older than five minutes. To link from your app
instead, send people to `/auth/token?token=<one-time token>&returnTo=/b/<id>`: Meshboard posts
`{"token": "…"}` the same way and starts its own session.

## Who can open a board

A board has an owner, members (editors or viewers) and a general access: only the people added,
everyone at the organisation, or everyone in one group, who can view or edit. Viewers get a
read-only board, and the server ignores any change they send. The owner shares from the board's
**Share** button. Removing someone or changing the general access reconnects everyone on the board
with the new rights. Deleted boards stay in the owner's trash until deleted for good.

## API and tokens

The dashboard uses a JSON API under `/api/v1` (`boards`, `boards/:id`, `members`, `export`,
`import`, `star`, `restore`, `people`, `me`). Scripts can call it with a token, created where the
server runs:

```bash
docker exec meshboard node --disable-warning=ExperimentalWarning server/src/cli.ts token create --owner anna@acme.example --name reports --scopes boards:read --days 90
```

The token is shown once: send it as `Authorization: Bearer mbt_…`. It acts as its owner, narrowed
to its scopes (`boards:read`, `boards:write`), and can't open live sync. `token list` and
`token revoke <id>` manage them.

## Webhooks

With `WEBHOOK_URL` set, Meshboard posts `board.created`, `board.updated` (at most once a minute per
board), `board.trashed`, `board.restored`, `board.deleted`, `member.added` and `member.removed`,
signed like the sign-in webhook and retried a few times. Skip event ids you've already seen.

## Running it

- **HTTPS** ends at your reverse proxy. It must pass WebSockets on `/sync` (with nginx:
  `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).
- **Backups** are the database's: copy `/data` (SQLite, best with the server stopped or with
  `sqlite3 .backup`), or back up the Postgres database as usual.
- **Upgrades:** pull the new image and restart. Migrations run at startup, forward only.
- **Health:** `/healthz` (the process) and `/readyz` (the database) for Docker and Kubernetes.
- **Logs** are JSON lines on standard output, without board content, tokens or cookies.
- **One instance** is enough for most organisations: boards are kept in memory while open.

## Developing it

```bash
MESHBOARD_URL=http://localhost:5173 PORT=8080 HOST=127.0.0.1 DATA_DIR=.data npm run server
MESHBOARD_SERVER=http://localhost:8080 npm run dev
```

Vite serves the app with hot reload and passes `/config.json`, `/api`, `/auth` and `/sync` to the
server. The server's tests are in `server/test/`; `TEST_DATABASE_URL=postgres://…` runs them on
Postgres (one file at a time: `--test-concurrency=1`).
