import { headers } from 'next/headers.js'
import type { Payload } from 'payload'
import { cache } from 'react'

import type { MasqUser } from '../types.js'

/** The signed-in user of this request, looked up once per render. */
export const currentUser = cache(async (payload: Payload): Promise<MasqUser | null> => {
  const { user } = await payload.auth({ headers: await headers() })
  return (user as unknown as MasqUser) ?? null
})
