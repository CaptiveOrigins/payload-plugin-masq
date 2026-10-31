import type { Payload, PayloadRequest } from 'payload'

/** A user document of the masquerade collection (any auth collection). */
export type MasqUser = { id: number | string; email?: string | null } & Record<string, unknown>

export type MasqPermissionArgs = {
  payload: Payload
  /** The signed-in user who wants to masquerade. */
  user: MasqUser
  /** The account to masquerade as; absent when asking whether `user` may use masquerade at all (search, menu). */
  target?: MasqUser
}

export type MasqStartArgs = { req: PayloadRequest; masquerader: MasqUser; target: MasqUser; reason: string | null }
export type MasqStopArgs = {
  req: PayloadRequest
  masqueraderId: string
  targetId: string
  /** The borrowed session had already ended (expired or signed out). */
  expired: boolean
  /** The masquerader's own session was restored. */
  restored: boolean
}

export type MasqPluginOptions = {
  /** Auth collection to masquerade in. Default `users`. */
  collection?: string
  /**
   * Who may masquerade, and as whom. Required: there is no default, so nobody
   * can masquerade until you decide. Masquerading as oneself and nesting are
   * always refused.
   */
  canMasquerade: (args: MasqPermissionArgs) => boolean | Promise<boolean>
  /** Length of the borrowed session in seconds. Default 3600 (one hour). */
  duration?: number
  /**
   * Look, don't touch: refuse create, update and delete while masquerading, everywhere
   * Payload runs (REST, GraphQL, admin, Local API with the request). Payload's own
   * bookkeeping (preferences, document locks) still works so the admin behaves normally.
   * Default true. For your own server actions, call `assertNotMasquerading(payload, headers)`.
   */
  readOnly?: boolean
  /** Ask for a reason before starting; it is passed to `onStart`. Default false. */
  requireReason?: boolean
  /** Field shown as each user's name in the search. Default `email`. */
  labelField?: string
  /** Fields the admin search matches (`like`). Default `['email']`. */
  searchFields?: string[]
  /** Where to go after starting. Default: the admin dashboard. */
  startPath?: string
  /** Add the banner to the admin header. Default true. */
  adminBanner?: boolean
  /** Show a Masquerade column (button per row) in the users list by default. Default true. */
  listColumn?: boolean
  /** Add the "Masquerade" view (admin-only user search) and its nav link. Default true. */
  adminView?: boolean
  onStart?: (args: MasqStartArgs) => void | Promise<void>
  onStop?: (args: MasqStopArgs) => void | Promise<void>
  enabled?: boolean
}

export type ResolvedMasqOptions = Required<Omit<MasqPluginOptions, 'onStart' | 'onStop' | 'startPath'>> &
  Pick<MasqPluginOptions, 'onStart' | 'onStop'> & { startPath: string; apiRoute: string; adminRoute: string }

/** The signed state of an active masquerade (in an httpOnly cookie). */
export type MasqState = {
  /** Masquerader id. */
  by: string
  /** Target id. */
  as: string
  /** Started (ISO). */
  at: string
  /** Borrowed session ends (ISO). */
  until: string
}
