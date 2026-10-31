import { APIError, type CollectionBeforeOperationHook, type Config, type Plugin } from 'payload'

import { searchEndpoint, startEndpoint, stopEndpoint } from './endpoints.js'
import { masqStateOf } from './state.js'
import type { MasqPluginOptions, ResolvedMasqOptions } from './types.js'

/** Read-only masquerade: refuse writes while masquerading (the stop endpoint writes below hooks). */
const readOnlyGuard: CollectionBeforeOperationHook = ({ args, operation, req }) => {
  if (req.context?.masqInternal) return args
  if ((operation === 'create' || operation === 'update' || operation === 'delete') && masqStateOf(req.payload, req.headers))
    throw new APIError('Masquerade is read-only: changes are turned off.', 403, undefined, true)
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
      readOnly: options.readOnly ?? false,
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
    return {
      ...config,
      custom: { ...config.custom, masq: resolved },
      admin: {
        ...config.admin,
        components: {
          ...components,
          header: [...(components.header ?? []), ...(resolved.adminBanner ? ['payload-plugin-masq/rsc#AdminMasqueradeBanner'] : [])],
          afterNavLinks: [...(components.afterNavLinks ?? []), ...(resolved.adminView ? ['payload-plugin-masq/rsc#MasqueradeNavLink'] : [])],
          views: {
            ...components.views,
            ...(resolved.adminView ? { masquerade: { Component: 'payload-plugin-masq/rsc#MasqueradeView', path: '/masquerade' } } : {}),
          },
        },
      },
      collections: (config.collections ?? []).map((c) => {
        const hooks = resolved.readOnly ? { ...c.hooks, beforeOperation: [...(c.hooks?.beforeOperation ?? []), readOnlyGuard] } : c.hooks
        if (c.slug !== collection) return { ...c, hooks }
        const columns = c.admin?.defaultColumns
        return {
          ...c,
          hooks,
          admin: resolved.listColumn && columns ? { ...c.admin, defaultColumns: [...columns, 'masq'] } : c.admin,
          endpoints: [stopEndpoint, searchEndpoint, startEndpoint, ...(c.endpoints || [])],
          fields: [
            {
              name: 'masq',
              type: 'ui',
              label: 'Masquerade',
              admin: {
                position: 'sidebar',
                components: { Field: 'payload-plugin-masq/rsc#MasqueradeField', Cell: 'payload-plugin-masq/rsc#MasqueradeCell' },
              },
            },
            ...c.fields,
          ],
        }
      }),
    }
  }
