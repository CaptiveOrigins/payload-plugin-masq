import crypto from 'node:crypto'

import type { Payload, PayloadRequest } from 'payload'
import { generateCookie, parseCookies } from 'payload/shared'

import type { MasqState, ResolvedMasqOptions } from './types.js'

export const STATE_COOKIE = 'payload-masq'
export const RETURN_COOKIE = 'payload-masq-return'

const mac = (secret: string, body: string) => crypto.createHmac('sha256', secret).update(`masq:${body}`).digest('base64url')

export function encodeState(secret: string, state: MasqState): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${body}.${mac(secret, body)}`
}

/** The state from a signed cookie value, or null if missing, forged or malformed. */
export function decodeState(secret: string, raw: string | null | undefined): MasqState | null {
  if (!raw) return null
  const [body, sig] = raw.split('.')
  if (!body || !sig) return null
  const expected = Buffer.from(mac(secret, body))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<MasqState>
    return s.by && s.as && s.at && s.until ? (s as MasqState) : null
  } catch {
    return null
  }
}

/** The active masquerade of a request (from its cookies), if any. */
export const masqStateOf = (payload: Payload, headers: Headers | null | undefined) =>
  headers ? decodeState(payload.secret, parseCookies(headers).get(STATE_COOKIE)) : null

/** The masquerader's id for a request, for audit trails: `masqueraderOf(req)`. */
export const masqueraderOf = (req: Pick<PayloadRequest, 'headers' | 'payload'>) => masqStateOf(req.payload, req.headers)?.by ?? null

export const masqOptions = (payload: Payload) => payload.config.custom?.masq as ResolvedMasqOptions

export function cookie(payload: Payload, slug: string, name: string, value: string, seconds: number, path = '/') {
  const auth = payload.collections[slug as never]!.config.auth
  return generateCookie<string>({
    name,
    value,
    path,
    httpOnly: true,
    secure: auth.cookies.secure,
    sameSite: 'Lax',
    domain: auth.cookies.domain ?? undefined,
    expires: new Date(Date.now() + seconds * 1000),
    returnCookieAsObject: false,
  })
}
