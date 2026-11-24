// What the build passes in through import.meta.env (see vite.config.ts and the deploy workflow).
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** the source repository, for the home screen's link; empty in development */
  readonly VITE_REPO_URL?: string
  /** the public address, for link previews (og:image) */
  readonly VITE_SITE_URL?: string
  /** optional TURN relays, see src/sync/ice.ts and the README */
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
  readonly VITE_TURN_CREDENTIALS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
