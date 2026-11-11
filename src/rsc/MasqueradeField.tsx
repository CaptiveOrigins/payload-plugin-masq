import { headers } from 'next/headers.js'
import type { Payload, PayloadRequest } from 'payload'
import React from 'react'

import { MasqueradeButton } from '../client/MasqueradeButton.js'
import { isMasquerading, masqOptions } from '../state.js'
import { currentUser } from './currentUser.js'
import type { MasqUser } from '../types.js'

/** Sidebar button on a user's account page, shown only to people allowed to masquerade as that user. */
export async function MasqueradeField({ payload, req, id, data }: { payload: Payload; req: PayloadRequest; id?: number | string; data?: Record<string, unknown> }) {
  const user = req?.user as unknown as MasqUser | null
  if (!id || !user || String(user.id) === String(id) || isMasquerading(payload, req.headers)) return null
  const opts = masqOptions(payload)
  if (!(await opts.canMasquerade({ payload, user, target: { ...(data ?? {}), id } as MasqUser }))) return null
  return (
    <MasqueradeButton
      apiPath={`${opts.apiRoute}/${opts.collection}`}
      userId={String(id)}
      requireReason={opts.requireReason}
      hint={`See the site and admin as they do, for ${Math.round(opts.duration / 60)} minutes${opts.readOnly ? ', read-only' : ''}. A banner takes you back.`}
    />
  )
}

/** Users list column: a Masquerade button per row the viewer may masquerade as. */
export async function MasqueradeCell({ payload, rowData }: { payload: Payload; rowData: Record<string, unknown> }) {
  const user = await currentUser(payload)
  const id = rowData?.id as string | number | undefined
  if (!id || !user || String(user.id) === String(id) || isMasquerading(payload, await headers())) return null
  const opts = masqOptions(payload)
  if (!(await opts.canMasquerade({ payload, user, target: rowData as MasqUser }))) return null
  return <MasqueradeButton apiPath={`${opts.apiRoute}/${opts.collection}`} userId={String(id)} requireReason={opts.requireReason} label="Masquerade" />
}
