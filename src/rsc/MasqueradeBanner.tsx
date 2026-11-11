import { headers } from 'next/headers.js'
import type { Payload } from 'payload'
import React from 'react'

import { ReturnButton } from '../client/ReturnButton.js'
import { masqOptions, masqStateOf } from '../state.js'
import type { MasqUser } from '../types.js'
import { currentUser } from './currentUser.js'

/**
 * "You're masquerading as …" with a button back to your own account. Renders
 * nothing unless the request carries a valid masquerade. It names the target only
 * while the borrowed session is live and the masquerader may still masquerade as
 * them; otherwise it says the masquerade is over, names nobody, and offers the way
 * back. Added to the admin header by the plugin; put it in your site layout too:
 * `<MasqueradeBanner payload={payload} />`.
 */
export async function MasqueradeBanner({ payload, className }: { payload: Payload; className?: string }) {
  const state = masqStateOf(payload, await headers())
  if (!state) return null
  const opts = masqOptions(payload)
  const stopPath = `${opts.apiRoute}/${opts.collection}/masq/stop`
  const viewer = (await currentUser(payload)) as (MasqUser & { collection?: string }) | null
  const live = Boolean(viewer && viewer.collection === opts.collection && String(viewer.id) === state.as)
  const masquerader = live
    ? ((await payload.findByID({ collection: opts.collection as never, id: state.by, depth: 0, overrideAccess: true, disableErrors: true })) as MasqUser | null)
    : null
  const allowed = Boolean(live && masquerader && (await opts.canMasquerade({ payload, user: masquerader, target: viewer! })))
  if (!allowed)
    return (
      <Bar className={className} stopPath={stopPath}>
        {live ? 'You may no longer masquerade as this user.' : 'Your masquerade has ended.'}
      </Bar>
    )
  const target = viewer!
  const name = String(target[opts.labelField] ?? target.email ?? state.as)
  const email = target.email && target.email !== name ? ` (${String(target.email)})` : ''
  const minutes = Math.max(0, Math.round((Date.parse(state.until) - Date.now()) / 60000))
  return (
    <Bar className={className} stopPath={stopPath}>
      You’re masquerading as <strong>{name}</strong>
      {email}
      {opts.readOnly ? ', read-only' : ''}. {minutes > 0 ? `Ends in ${minutes} min.` : 'The session has ended.'}
    </Bar>
  )
}

function Bar({ className, stopPath, children }: { className?: string; stopPath: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={className ?? 'masq-banner'}
      style={{
        position: 'fixed',
        insetInline: 0,
        bottom: 0,
        zIndex: 1000,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.6rem 1rem',
        background: '#7c2d12',
        color: '#fff',
        fontSize: '0.9rem',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.25)',
      }}
    >
      <span>{children}</span>
      <ReturnButton stopPath={stopPath} />
    </div>
  )
}

/** Admin header slot (registered by the plugin). */
export async function AdminMasqueradeBanner({ payload }: { payload: Payload }) {
  return <MasqueradeBanner payload={payload} />
}
