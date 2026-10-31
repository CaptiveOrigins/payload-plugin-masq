import { headers } from 'next/headers.js'
import type { Payload } from 'payload'
import React from 'react'

import { ReturnButton } from '../client/ReturnButton.js'
import { masqOptions, masqStateOf } from '../state.js'

/**
 * "You're masquerading as …" with a button back to your own account. Renders
 * nothing unless the request carries a valid masquerade. Added to the admin
 * header by the plugin; put it in your site layout too: `<MasqueradeBanner payload={payload} />`.
 */
export async function MasqueradeBanner({ payload, className }: { payload: Payload; className?: string }) {
  const state = masqStateOf(payload, await headers())
  if (!state) return null
  const opts = masqOptions(payload)
  const target = (await payload.findByID({ collection: opts.collection as never, id: state.as, depth: 0, overrideAccess: true, disableErrors: true })) as Record<
    string,
    unknown
  > | null
  const name = target ? String(target[opts.labelField] ?? target.email ?? state.as) : 'a removed account'
  const email = target?.email && target.email !== name ? ` (${String(target.email)})` : ''
  const minutes = Math.max(0, Math.round((Date.parse(state.until) - Date.now()) / 60000))
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
      <span>
        You’re masquerading as <strong>{name}</strong>
        {email}
        {opts.readOnly ? ', read-only' : ''}. {minutes > 0 ? `Ends in ${minutes} min.` : 'The session has ended.'}
      </span>
      <ReturnButton stopPath={`${opts.apiRoute}/${opts.collection}/masq/stop`} />
    </div>
  )
}

/** Admin header slot (registered by the plugin). */
export async function AdminMasqueradeBanner({ payload }: { payload: Payload }) {
  return <MasqueradeBanner payload={payload} />
}
