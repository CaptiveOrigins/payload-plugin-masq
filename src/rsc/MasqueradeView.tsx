import { DefaultTemplate } from '@payloadcms/next/templates'
import { headers } from 'next/headers.js'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { MasqueradeSearch, QuickMasquerade } from '../client/MasqueradeSearch.js'
import { isMasquerading, masqOptions } from '../state.js'
import type { MasqUser } from '../types.js'

/** The Masquerade area (/admin/masquerade): quick "Masquerade as…" and a user search, for people allowed to masquerade. */
export async function MasqueradeView({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const { payload } = req
  const opts = masqOptions(payload)
  const user = req.user as unknown as MasqUser | null
  // Not while masquerading: there is no nesting.
  const nested = isMasquerading(payload, req.headers)
  const allowed = Boolean(user && !nested && (await opts.canMasquerade({ payload, user })))
  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user ?? undefined}
      visibleEntities={visibleEntities}
    >
      <div className="gutter--left gutter--right" style={{ paddingBlock: 'calc(var(--base) * 2)' }}>
        <h1>Masquerade</h1>
        {allowed ? (
          <>
            <p style={{ maxWidth: 680, marginBottom: 'calc(var(--base) * 1.5)' }}>
              Sign in as someone to see the site and admin exactly as they do, for {Math.round(opts.duration / 60)} minutes
              {opts.readOnly ? ', read-only: you can look everywhere they can, but not create, change or delete anything' : ''}. Find them below, or open their
              account and use “Masquerade as this user”. A banner takes you back to your own account.
            </p>
            <QuickMasquerade apiPath={`${opts.apiRoute}/${opts.collection}`} requireReason={opts.requireReason} />
            <h2 style={{ marginTop: 'calc(var(--base) * 2)' }}>Find a user</h2>
            <MasqueradeSearch apiPath={`${opts.apiRoute}/${opts.collection}`} adminRoute={opts.adminRoute} collection={opts.collection} requireReason={opts.requireReason} />
          </>
        ) : (
          <p>{nested ? 'Return to your own account before you masquerade as someone else.' : 'You don’t have permission to masquerade.'}</p>
        )}
      </div>
    </DefaultTemplate>
  )
}

/** Nav link to the Masquerade area, only for people allowed to masquerade. */
export async function MasqueradeNavLink({ payload, user }: { payload: import('payload').Payload; user?: unknown }) {
  const opts = masqOptions(payload)
  if (!user || isMasquerading(payload, await headers()) || !(await opts.canMasquerade({ payload, user: user as MasqUser }))) return null
  return (
    <a className="nav__link" href={`${opts.adminRoute}/masquerade`} style={{ display: 'block', marginTop: 'calc(var(--base) / 2)' }}>
      <span className="nav__link-label">Masquerade</span>
    </a>
  )
}
