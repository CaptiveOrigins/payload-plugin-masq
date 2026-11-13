import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, createLocalReq, getPayload, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assertNotMasquerading, decodeState, masqPlugin, masqueraderOf, STATE_COOKIE, type MasqStartArgs, type MasqStopArgs } from '../src/index.js'

type U = { id: string; email: string; role: string }
let payload: Payload
let mongo: MongoMemoryReplSet
let admin: U
let admin2: U
let member: U
const started: MasqStartArgs[] = []
const stopped: MasqStopArgs[] = []
const PW = 'correct-horse-battery'

const endpoint = (path: string) => (payload.collections.users!.config.endpoints as Endpoint[]).find((e) => e.path === path)!

/** Calls an endpoint as REST would: signed in from `cookies['payload-token']` like a browser. */
async function call(path: string, cookies: Record<string, string>, opts: { id?: string; body?: unknown; query?: string } = {}) {
  const headers = new Headers({ cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') })
  const token = cookies['payload-token']
  const { user } = token ? await payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) }) : { user: null }
  const req = (await createLocalReq({ user: (user ?? undefined) as never }, payload)) as PayloadRequest
  if (!user) req.user = null
  ;(req as { headers: Headers }).headers = headers
  req.routeParams = opts.id ? { id: opts.id } : {}
  ;(req as { searchParams: URLSearchParams }).searchParams = new URLSearchParams(opts.query ?? '')
  req.data = (opts.body ?? {}) as never
  try {
    return await endpoint(path).handler(req)
  } catch (error) {
    return new Response(JSON.stringify({ errors: [{ message: (error as Error).message }] }), { status: (error as { status?: number }).status ?? 500 })
  }
}

const jar = (res: Response) =>
  Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0]!.split('=')).map(([k, ...v]) => [k!, v.join('=')]))
const login = async (u: U) => (await payload.login({ collection: 'users', data: { email: u.email, password: PW } })).token!

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('masq'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, admin: { defaultColumns: ['email'] }, fields: [{ name: 'role', type: 'select', options: ['admin', 'member'], defaultValue: 'member' }, { name: 'name', type: 'text' }] },
        { slug: 'notes', access: { create: () => true, read: () => true }, fields: [{ name: 'text', type: 'text' }] },
      ],
      plugins: [
        masqPlugin({
          // Admins may masquerade as anyone, including other admins.
          canMasquerade: ({ user }) => user.role === 'admin',
          searchFields: ['email', 'name'],
          labelField: 'name',
          onStart: (a) => void started.push(a),
          onStop: (a) => void stopped.push(a),
        }),
      ],
    }),
  })
  const make = (email: string, role: string, name: string) =>
    payload.create({ collection: 'users', data: { email, password: PW, role, name } as never }) as unknown as Promise<U>
  admin = await make('admin@example.com', 'admin', 'Ada Admin')
  admin2 = await make('admin2@example.com', 'admin', 'Bea Admin')
  member = await make('member@example.com', 'member', 'Cy Member')
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

describe('masquerade', () => {
  it('adds endpoints, the admin view, banner, nav link and the account-page field', () => {
    const paths = (payload.collections.users!.config.endpoints as Endpoint[]).map((e) => e.path)
    expect(paths).toEqual(expect.arrayContaining(['/:id/masq', '/masq/stop', '/masq/search']))
    expect(payload.config.admin.components.views?.masquerade).toMatchObject({ path: '/masquerade' })
    expect(payload.config.admin.components.header).toContain('@extantape/payload-plugin-masq/rsc#AdminMasqueradeBanner')
    expect(payload.collections.users!.config.fields.some((f) => 'name' in f && f.name === 'masq')).toBe(true)
    expect(payload.collections.users!.config.admin.defaultColumns).toEqual(['email', 'masq'])
  })

  it('borrows a one-hour session of the target and returns to the masquerader', async () => {
    const own = await login(admin)
    expect((await call('/:id/masq', { 'payload-token': await login(member) }, { id: admin.id })).status).toBe(403)
    expect((await call('/:id/masq', { 'payload-token': own }, { id: admin.id })).status).toBe(400)

    const res = await call('/:id/masq', { 'payload-token': own }, { id: member.id, body: { reason: 'Ticket 42' } })
    expect(res.status).toBe(200)
    const c = jar(res)
    const state = decodeState(payload.secret, c[STATE_COOKIE])
    expect(state).toMatchObject({ by: admin.id, as: member.id })
    expect(Date.parse(state!.until) - Date.parse(state!.at)).toBe(3600_000)
    expect((await payload.auth({ headers: new Headers({ Authorization: `JWT ${c['payload-token']}` }) })).user?.id).toBe(member.id)
    expect(started.at(-1)).toMatchObject({ reason: 'Ticket 42', target: { id: member.id } })
    expect(masqueraderOf({ payload, headers: new Headers({ cookie: `${STATE_COOKIE}=${c[STATE_COOKIE]}` }) })).toBe(admin.id)

    // No nesting.
    expect((await call('/:id/masq', { 'payload-token': own, [STATE_COOKIE]: c[STATE_COOKIE]! }, { id: admin2.id })).status).toBe(400)

    const back = await call('/masq/stop', { 'payload-token': c['payload-token']!, [STATE_COOKIE]: c[STATE_COOKIE]!, 'payload-masq-return': c['payload-masq-return']! })
    expect(await back.json()).toMatchObject({ restored: true, redirect: `/admin/collections/users/${member.id}` })
    expect(jar(back)['payload-token']).toBe(own)
    expect(stopped.at(-1)).toMatchObject({ masqueraderId: admin.id, targetId: member.id, expired: false, restored: true })
    // The borrowed session is ended.
    expect((await payload.auth({ headers: new Headers({ Authorization: `JWT ${c['payload-token']}` }) })).user).toBeNull()
  })

  it('is read-only while masquerading, through the request', async () => {
    const c = jar(await call('/:id/masq', { 'payload-token': await login(admin) }, { id: member.id }))
    const headers = new Headers({ cookie: `payload-token=${c['payload-token']}; ${STATE_COOKIE}=${c[STATE_COOKIE]}` })
    const { user } = await payload.auth({ headers })
    const req = (await createLocalReq({ user: user as never }, payload)) as PayloadRequest
    ;(req as { headers: Headers }).headers = headers
    await expect(payload.create({ collection: 'notes', data: { text: 'x' }, req, overrideAccess: false })).rejects.toThrow(/read-only/)
    await expect(payload.update({ collection: 'users', id: member.id, data: { name: 'Changed' }, req, overrideAccess: false })).rejects.toThrow(/read-only/)
    expect((await payload.find({ collection: 'notes', req, overrideAccess: false })).docs).toEqual([])
    expect(() => assertNotMasquerading(payload, headers)).toThrow(/read-only/)
    expect(() => assertNotMasquerading(payload, new Headers())).not.toThrow()
  })

  it('lets admins masquerade as other admins', async () => {
    const res = await call('/:id/masq', { 'payload-token': await login(admin) }, { id: admin2.id })
    expect(res.status).toBe(200)
  })

  it('never restores from a forged state or a token of someone else', async () => {
    const memberToken = await login(member)
    const forged = await call('/masq/stop', { 'payload-token': memberToken, [STATE_COOKIE]: 'eyJieSI6IngifQ.bad', 'payload-masq-return': memberToken })
    expect(await forged.json()).toMatchObject({ restored: false })
    expect(jar(forged)['payload-token']).toBe('')
  })

  it('searches users only for people allowed to masquerade, with their own access', async () => {
    expect((await call('/masq/search', { 'payload-token': await login(member) }, { query: 'q=a' })).status).toBe(403)
    expect((await call('/masq/search', {}, { query: 'q=a' })).status).toBe(401)
    const res = await call('/masq/search', { 'payload-token': await login(admin) }, { query: 'q=Cy' })
    const body = (await res.json()) as { docs: { id: string; label: string; allowed: boolean }[] }
    expect(body.docs).toEqual([{ id: member.id, label: 'Cy Member', email: 'member@example.com', allowed: true }])
    const all = (await (await call('/masq/search', { 'payload-token': await login(admin) })).json()) as { docs: { id: string }[] }
    expect(all.docs.map((d) => d.id)).not.toContain(admin.id)
  })
})

describe('masquerade refusals (fail closed)', () => {
  const opts = () => payload.config.custom!.masq as { canMasquerade: (a: { user: U; target?: U }) => boolean; requireReason: boolean }
  /** Runs `fn` with a temporary change to the resolved options, then puts them back. */
  async function withOpts<T>(patch: Record<string, unknown>, fn: () => Promise<T>) {
    const before = { ...opts() }
    Object.assign(opts(), patch)
    try {
      return await fn()
    } finally {
      Object.assign(opts(), before)
    }
  }

  it('refuses to start when signed out, for a missing user, or without a browser sign-in', async () => {
    expect((await call('/:id/masq', {}, { id: member.id })).status).toBe(401)
    expect((await call('/:id/masq', { 'payload-token': await login(admin) }, { id: '000000000000000000000000' })).status).toBe(404)
    // Signed in, but not through the browser cookie: there is nothing to return to.
    const { user } = await payload.auth({ headers: new Headers({ Authorization: `JWT ${await login(admin)}` }) })
    const req = (await createLocalReq({ user: user as never }, payload)) as PayloadRequest
    ;(req as { headers: Headers }).headers = new Headers()
    req.routeParams = { id: member.id }
    req.data = {} as never
    await expect(endpoint('/:id/masq').handler(req)).rejects.toThrow(/browser sign-in/)
  })

  it('asks canMasquerade about the target, and needs a reason when required', async () => {
    const own = await login(admin)
    const noMembers = await withOpts({ canMasquerade: ({ target }: { target?: U }) => target?.role !== 'member' }, () => call('/:id/masq', { 'payload-token': own }, { id: member.id }))
    expect(noMembers.status).toBe(403)
    const noReason = await withOpts({ requireReason: true }, () => call('/:id/masq', { 'payload-token': own }, { id: member.id, body: { reason: '   ' } }))
    expect(noReason.status).toBe(400)
  })

  it('scopes the cookies: httpOnly, and the return token only to the stop endpoint', async () => {
    const res = await call('/:id/masq', { 'payload-token': await login(admin) }, { id: member.id })
    const set = res.headers.getSetCookie()
    expect(set).toHaveLength(3)
    for (const c of set) expect(c).toMatch(/HttpOnly/i)
    expect(set.find((c) => c.startsWith('payload-masq-return='))).toMatch(/Path=\/api\/users\/masq\/stop/)
  })

  it('does not restore a masquerader who lost permission, and signs them out', async () => {
    const c = jar(await call('/:id/masq', { 'payload-token': await login(admin) }, { id: member.id }))
    const back = await withOpts({ canMasquerade: () => false }, () =>
      call('/masq/stop', { 'payload-token': c['payload-token']!, [STATE_COOKIE]: c[STATE_COOKIE]!, 'payload-masq-return': c['payload-masq-return']! }),
    )
    expect(await back.json()).toMatchObject({ restored: false, redirect: '/admin/login' })
    expect(jar(back)['payload-token']).toBe('')
    expect(stopped.at(-1)).toMatchObject({ masqueraderId: admin.id, restored: false })
  })

  it('does not restore a valid token that belongs to someone other than the masquerader', async () => {
    const c = jar(await call('/:id/masq', { 'payload-token': await login(admin) }, { id: member.id }))
    const back = await call('/masq/stop', { 'payload-token': c['payload-token']!, [STATE_COOKIE]: c[STATE_COOKIE]!, 'payload-masq-return': await login(admin2) })
    expect(await back.json()).toMatchObject({ restored: false })
    expect(jar(back)['payload-token']).toBe('')
  })

  it('reports an expired borrowed session on return', async () => {
    const own = await login(admin)
    const c = jar(await call('/:id/masq', { 'payload-token': own }, { id: member.id }))
    const back = await call('/masq/stop', { [STATE_COOKIE]: c[STATE_COOKIE]!, 'payload-masq-return': c['payload-masq-return']! })
    expect(await back.json()).toMatchObject({ restored: true })
    expect(stopped.at(-1)).toMatchObject({ expired: true, restored: true })
  })

  it('search lists only users the masquerader can read, and marks targets they may not use', async () => {
    const users = payload.collections.users!.config
    const read = users.access.read
    users.access.read = (() => ({ role: { equals: 'admin' } })) as never
    try {
      const hidden = (await (await call('/masq/search', { 'payload-token': await login(admin) }, { query: 'q=Cy' })).json()) as { docs: unknown[] }
      expect(hidden.docs).toEqual([])
    } finally {
      users.access.read = read
    }
    const body = await withOpts({ canMasquerade: ({ user, target }: { user: U; target?: U }) => user.role === 'admin' && target?.role !== 'admin' }, async () =>
      (await (await call('/masq/search', { 'payload-token': await login(admin) })).json()) as { docs: { id: string; allowed: boolean }[] },
    )
    expect(body.docs.find((d) => d.id === admin2.id)?.allowed).toBe(false)
    expect(body.docs.find((d) => d.id === member.id)?.allowed).toBe(true)
  })
})
