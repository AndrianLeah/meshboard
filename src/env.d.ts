// What the build passes in through import.meta.env (see vite.config.ts and the deploy workflow).
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** the source repository, for the home screen's link; empty in development */
  readonly VITE_REPO_URL?: string
  /** the public address, for link previews (og:image) */
  readonly VITE_SITE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
