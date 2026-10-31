import { addDataAndFileToRequest, APIError, getFieldsToSign, jwtSign, type Endpoint, type PayloadRequest, type Where } from 'payload'
import { addSessionToUser, parseCookies } from 'payload/shared'

import { cookie, encodeState, masqOptions, masqStateOf, RETURN_COOKIE, STATE_COOKIE } from './state.js'
import type { MasqUser } from './types.js'

const STATE_SECONDS = 24 * 60 * 60

const json = (body: unknown, cookies: string[] = [], status = 200) => {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

const tokenCookie = (req: PayloadRequest) => `${req.payload.config.cookiePrefix}-token`

/** The signed-in user of the masquerade collection, or a 403. */
function signedIn(req: PayloadRequest): MasqUser {
  const { collection } = masqOptions(req.payload)
  if (!req.user || req.user.collection !== collection) throw new APIError('Sign in first.', 401, undefined, true)
  return req.user as unknown as MasqUser
}

/** POST /api/<collection>/:id/masq  { reason? } */
export const startEndpoint: Endpoint = {
  path: '/:id/masq',
  method: 'post',
  handler: async (req) => {
    const opts = masqOptions(req.payload)
    const user = signedIn(req)
    if (masqStateOf(req.payload, req.headers)) throw new APIError('Stop masquerading first.', 400, undefined, true)
    const own = parseCookies(req.headers).get(tokenCookie(req))
    if (!own) throw new APIError('Masquerade needs a browser sign-in.', 400, undefined, true)
    const id = String(req.routeParams?.id ?? '')
    if (!id || id === String(user.id)) throw new APIError('Choose another user.', 400, undefined, true)
    await addDataAndFileToRequest(req)
    const reason = typeof req.data?.reason === 'string' ? req.data.reason.trim().slice(0, 500) || null : null
    if (opts.requireReason && !reason) throw new APIError('Say why you are masquerading.', 400, undefined, true)

    const target = (await req.payload.findByID({
      collection: opts.collection as never,
      id,
      depth: 0,
      overrideAccess: true,
      showHiddenFields: true,
      disableErrors: true,
      req,
    })) as MasqUser | null
    if (!target) throw new APIError('User not found.', 404, undefined, true)
    if (!(await opts.canMasquerade({ payload: req.payload, user, target }))) throw new APIError('You may not masquerade as this user.', 403, undefined, true)

    const collectionConfig = req.payload.collections[opts.collection as never]!.config
    const { sid } = await addSessionToUser({ collectionConfig, payload: req.payload, req, user: target as never })
    const { token } = await jwtSign({
      fieldsToSign: getFieldsToSign({ collectionConfig, email: String(target.email ?? ''), sid, user: target as never }),
      secret: req.payload.secret,
      tokenExpiration: opts.duration,
    })
    const now = Date.now()
    const state = { by: String(user.id), as: id, at: new Date(now).toISOString(), until: new Date(now + opts.duration * 1000).toISOString() }
    await opts.onStart?.({ req, masquerader: user, target, reason })
    return json({ ok: true, redirect: opts.startPath }, [
      cookie(req.payload, opts.collection, tokenCookie(req), token, opts.duration),
      // The masquerader's own token goes back only to the stop endpoint.
      cookie(req.payload, opts.collection, RETURN_COOKIE, own, STATE_SECONDS, `${opts.apiRoute}/${opts.collection}/masq/stop`),
      cookie(req.payload, opts.collection, STATE_COOKIE, encodeState(req.payload.secret, state), STATE_SECONDS),
    ])
  },
}

/** POST /api/<collection>/masq/stop: end the borrowed session and restore the masquerader's own. */
export const stopEndpoint: Endpoint = {
  path: '/masq/stop',
  method: 'post',
  handler: async (req) => {
    const opts = masqOptions(req.payload)
    const state = masqStateOf(req.payload, req.headers)
    // Our own writes (and onStop's) are allowed even in read-only mode.
    req.context = { ...req.context, masqInternal: true }
    const own = parseCookies(req.headers).get(RETURN_COOKIE)
    const stopPath = `${opts.apiRoute}/${opts.collection}/masq/stop`
    const clear = [cookie(req.payload, opts.collection, RETURN_COOKIE, '', -1, stopPath), cookie(req.payload, opts.collection, STATE_COOKIE, '', -1)]

    // End the borrowed session if it is still alive.
    const borrowed = req.user as (MasqUser & { _sid?: string; collection?: string }) | null
    const live = Boolean(state && borrowed?.collection === opts.collection && String(borrowed.id) === state.as)
    if (live && borrowed?._sid) {
      const doc = (await req.payload.findByID({ collection: opts.collection as never, id: borrowed.id, depth: 0, overrideAccess: true, showHiddenFields: true, req })) as {
        sessions?: { id: string }[]
      }
      await req.payload.db.updateOne({
        collection: opts.collection,
        id: borrowed.id,
        data: { sessions: (doc.sessions ?? []).filter((s) => s.id !== borrowed._sid) },
        req,
        returning: false,
      })
    }

    // Restore only a still-valid token of the same masquerader who may still masquerade.
    const restored = state && own ? await req.payload.auth({ headers: new Headers({ Authorization: `JWT ${own}` }) }).catch(() => null) : null
    const user = (restored?.user ?? null) as MasqUser | null
    const ok = Boolean(state && user && String(user.id) === state.by && (await opts.canMasquerade({ payload: req.payload, user: user! })))
    if (state) await opts.onStop?.({ req, masqueraderId: state.by, targetId: state.as, expired: !live, restored: ok })
    if (!ok) return json({ ok: true, restored: false, redirect: `${opts.adminRoute}/login` }, [...clear, cookie(req.payload, opts.collection, tokenCookie(req), '', -1)])
    const seconds = req.payload.collections[opts.collection as never]!.config.auth.tokenExpiration
    return json({ ok: true, restored: true, redirect: `${opts.adminRoute}/collections/${opts.collection}/${state!.as}` }, [
      ...clear,
      cookie(req.payload, opts.collection, tokenCookie(req), own!, seconds),
    ])
  },
}

/**
 * GET /api/<collection>/masq/search?q=&page=: the admin user search. Only for
 * people allowed to masquerade at all, and it reads with their own access, so it
 * never shows a user they could not already see. Lists only users they may
 * masquerade as.
 */
export const searchEndpoint: Endpoint = {
  path: '/masq/search',
  method: 'get',
  handler: async (req) => {
    const opts = masqOptions(req.payload)
    const user = signedIn(req)
    if (!(await opts.canMasquerade({ payload: req.payload, user }))) throw new APIError('Not allowed.', 403, undefined, true)
    const q = String(req.searchParams?.get('q') ?? '').trim().slice(0, 100)
    const page = Math.max(1, Number(req.searchParams?.get('page')) || 1)
    const where: Where = {
      and: [{ id: { not_equals: user.id } }, ...(q ? [{ or: opts.searchFields.map((f) => ({ [f]: { like: q } })) }] : [])],
    }
    const found = await req.payload.find({
      collection: opts.collection as never,
      where,
      page,
      limit: 20,
      depth: 0,
      sort: opts.labelField,
      overrideAccess: false,
      user: req.user,
      req,
    })
    const docs = await Promise.all(
      (found.docs as MasqUser[]).map(async (d) => ({
        id: String(d.id),
        label: String(d[opts.labelField] ?? d.email ?? d.id),
        email: d.email ?? null,
        allowed: await opts.canMasquerade({ payload: req.payload, user, target: d }),
      })),
    )
    return json({ docs, page: found.page, totalPages: found.totalPages, totalDocs: found.totalDocs })
  },
}
