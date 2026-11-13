import { APIError, type CollectionBeforeOperationHook, type Config, type GlobalBeforeChangeHook, type GlobalBeforeOperationHook, type Plugin } from 'payload'

import { searchEndpoint, startEndpoint, stopEndpoint } from './endpoints.js'
import { borrowedBy, isMasquerading } from './state.js'
import type { MasqPluginOptions, ResolvedMasqOptions } from './types.js'

/** Payload's own bookkeeping, written while simply looking around the admin. */
const BOOKKEEPING = new Set(['payload-preferences', 'payload-locked-documents'])

export const READ_ONLY_MESSAGE = 'Masquerade is read-only: nothing can be created, changed or deleted while masquerading.'

/**
 * Every collection operation in Payload 3.92 that writes and runs `beforeOperation`. Login
 * (it only records the sign-in) and refresh (refused separately) are left out.
 */
const COLLECTION_WRITES = new Set(['create', 'update', 'delete', 'restoreVersion', 'unlock', 'forgotPassword', 'resetPassword'])

/** Global operations that write. A global restore skips `beforeChange`, so the guard sits here. */
const GLOBAL_WRITES = new Set(['update', 'restoreVersion'])

/** Read-only masquerade: refuse writes while masquerading (the plugin's own writes are marked internal). */
const readOnlyGuard: CollectionBeforeOperationHook = ({ args, operation, req }) => {
  if (req.context?.masqInternal) return args
  if (COLLECTION_WRITES.has(operation) && isMasquerading(req.payload, req.headers)) throw new APIError(READ_ONLY_MESSAGE, 403, undefined, true)
  return args
}

const globalReadOnlyGuard: GlobalBeforeOperationHook = ({ args, operation, req }) => {
  if (req.context?.masqInternal) return args
  if (GLOBAL_WRITES.has(operation) && isMasquerading(req.payload, req.headers)) throw new APIError(READ_ONLY_MESSAGE, 403, undefined, true)
  return args
}

/** A borrowed session ends on time: it can't be refreshed (the admin refreshes tokens while you're active). */
const noBorrowedRefresh: CollectionBeforeOperationHook = ({ args, operation, req }) => {
  if (operation === 'refresh' && borrowedBy(req.payload, req.headers)) throw new APIError('A masquerade session can’t be extended.', 403, undefined, true)
  return args
}

/**
 * Masquerade: an admin signs in as another user to see what they see.
 *
 * - The masquerader gets a real, short Payload session of the target (the same
 *   session machinery as a normal login), so every access rule applies exactly
 *   as for that user. Default one hour.
 * - Their own token waits in an httpOnly cookie sent only to the stop
 *   endpoint, and comes back only if it is still valid and they may still
 *   masquerade. The borrowed session is ended on return.
 * - A signed cookie records who is masquerading as whom, for the banner and
 *   for audit trails (`masqueraderOf(req)`).
 * - The admin gets a "Masquerade as this user" button on each user, a
 *   Masquerade view with a user search (only for people allowed to
 *   masquerade, reading with their own access), and a banner with
 *   "Return to my account". Put `<MasqueradeBanner />` in your site layout too.
 */
export const masqPlugin =
  (options: MasqPluginOptions): Plugin =>
  (config: Config): Config => {
    if (options.enabled === false) return config
    const collection = options.collection ?? 'users'
    const adminRoute = config.routes?.admin ?? '/admin'
    const resolved: ResolvedMasqOptions = {
      collection,
      canMasquerade: options.canMasquerade,
      duration: options.duration ?? 3600,
      readOnly: options.readOnly ?? true,
      requireReason: options.requireReason ?? false,
      labelField: options.labelField ?? 'email',
      searchFields: options.searchFields ?? ['email'],
      startPath: options.startPath ?? adminRoute,
      adminBanner: options.adminBanner ?? true,
      adminView: options.adminView ?? true,
      listColumn: options.listColumn ?? true,
      enabled: true,
      onStart: options.onStart,
      onStop: options.onStop,
      apiRoute: config.routes?.api ?? '/api',
      adminRoute,
    }
    if (!(config.collections ?? []).some((c) => c.slug === collection)) throw new Error(`payload-plugin-masq: no collection "${collection}"`)
    const components = config.admin?.components ?? {}
    const globals = resolved.readOnly
      ? (config.globals ?? []).map((g) => ({
          ...g,
          hooks: {
            ...g.hooks,
            beforeOperation: [...(g.hooks?.beforeOperation ?? []), globalReadOnlyGuard],
            beforeChange: [
              ...(g.hooks?.beforeChange ?? []),
              (({ data, req }) => {
                if (!req.context?.masqInternal && isMasquerading(req.payload, req.headers)) throw new APIError(READ_ONLY_MESSAGE, 403, undefined, true)
                return data
              }) as GlobalBeforeChangeHook,
            ],
          },
        }))
      : config.globals
    return {
      ...config,
      globals,
      custom: { ...config.custom, masq: resolved },
      admin: {
        ...config.admin,
        components: {
          ...components,
          header: [...(components.header ?? []), ...(resolved.adminBanner ? ['@extantape/payload-plugin-masq/rsc#AdminMasqueradeBanner'] : [])],
          afterNavLinks: [...(components.afterNavLinks ?? []), ...(resolved.adminView ? ['@extantape/payload-plugin-masq/rsc#MasqueradeNavLink'] : [])],
          views: {
            ...components.views,
            ...(resolved.adminView ? { masquerade: { Component: '@extantape/payload-plugin-masq/rsc#MasqueradeView', path: '/masquerade' } } : {}),
          },
        },
      },
      collections: (config.collections ?? []).map((c) => {
        const guarded = resolved.readOnly && !BOOKKEEPING.has(c.slug)
        const hooks = guarded ? { ...c.hooks, beforeOperation: [...(c.hooks?.beforeOperation ?? []), readOnlyGuard] } : c.hooks
        if (c.slug !== collection) return { ...c, hooks }
        const columns = c.admin?.defaultColumns
        return {
          ...c,
          hooks: { ...hooks, beforeOperation: [...(hooks?.beforeOperation ?? []), noBorrowedRefresh] },
          admin: resolved.listColumn && columns ? { ...c.admin, defaultColumns: [...columns, 'masq'] } : c.admin,
          endpoints: [stopEndpoint, searchEndpoint, startEndpoint, ...(c.endpoints || [])],
          fields: [
            {
              name: 'masq',
              type: 'ui',
              label: 'Masquerade',
              admin: {
                position: 'sidebar',
                components: { Field: '@extantape/payload-plugin-masq/rsc#MasqueradeField', Cell: '@extantape/payload-plugin-masq/rsc#MasqueradeCell' },
              },
            },
            ...c.fields,
          ],
        }
      }),
    }
  }
