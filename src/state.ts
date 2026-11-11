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

/** Claim that marks a borrowed session's token, with the masquerader's id. */
export const BORROWED_CLAIM = 'masqBy'

/**
 * The masquerader's id if the request's Payload token (cookie or Authorization
 * header) is a borrowed masquerade session. The token is only decoded, not
 * verified: a forged claim can only make its own request read-only, and
 * Payload verifies the token itself before it signs anyone in.
 */
export function borrowedBy(payload: Payload, headers: Headers | null | undefined): string | null {
  if (!headers) return null
  const auth = headers.get('Authorization') ?? ''
  const tokens = [parseCookies(headers).get(`${payload.config?.cookiePrefix ?? 'payload'}-token`), auth.replace(/^(JWT|Bearer) /, '')]
  for (const token of tokens) {
    const body = token?.split('.')[1]
    if (!body) continue
    try {
      const by = (JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>)[BORROWED_CLAIM]
      if (typeof by === 'string' && by) return by
    } catch {
      // Not a JWT we can read: not a borrowed session.
    }
  }
  return null
}

/**
 * Whether the request is masquerading: it carries the signed state cookie, or a
 * borrowed session's token (so dropping the state cookie doesn't lift read-only).
 */
export const isMasquerading = (payload: Payload, headers: Headers | null | undefined) =>
  Boolean(masqStateOf(payload, headers) || borrowedBy(payload, headers))

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

/**
 * For your own server actions and route handlers that write through the Local
 * API without the request: refuse while masquerading (read-only masquerade).
 */
export function assertNotMasquerading(payload: Payload, headers: Headers | null | undefined) {
  if ((payload.config.custom?.masq as ResolvedMasqOptions | undefined)?.readOnly !== false && isMasquerading(payload, headers))
    throw new Error('Masquerade is read-only: nothing can be created, changed or deleted while masquerading.')
}
