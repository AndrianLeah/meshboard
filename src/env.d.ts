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
  /** optional image uploads, see src/core/images.ts and docs/self-hosting.md */
  readonly VITE_UPLOAD_URL?: string
  readonly VITE_UPLOAD_METHOD?: string
  readonly VITE_UPLOAD_FIELD?: string
  readonly VITE_UPLOAD_HEADERS?: string
  readonly VITE_UPLOAD_CREDENTIALS?: string
  readonly VITE_UPLOAD_URL_PATH?: string
  readonly VITE_UPLOAD_WIDTH_PATH?: string
  readonly VITE_UPLOAD_HEIGHT_PATH?: string
  readonly VITE_UPLOAD_MAX_BYTES?: string
  readonly VITE_IMAGE_ORIGINS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
