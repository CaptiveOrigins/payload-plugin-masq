import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, createLocalReq, getPayload, handleEndpoints, type Payload, type PayloadRequest, type SanitizedConfig } from 'payload'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { masqPlugin, STATE_COOKIE, type MasqPermissionArgs } from '../src/index.js'
import { encodeState } from '../src/state.js'
import { AdminMasqueradeBanner, MasqueradeBanner, MasqueradeCell, MasqueradeField, MasqueradeNavLink, MasqueradeView } from '../src/rsc/index.js'

// A minimal render harness for the Server Components: Next's request APIs are
// mocked, Payload is real (in-memory MongoDB), and each component is awaited
// like an RSC and its element rendered to HTML with react-dom/server.
// Mocked: `next/headers` (the request's cookies), `next/navigation`, the admin's
// DefaultTemplate (a pass-through) and `@payloadcms/ui`'s Button (a plain button).

const next = vi.hoisted(() => {
  const state = { headers: new Headers(), navigations: [] as string[] }
  const headersModule = () => ({
    headers: async () => state.headers,
    cookies: async () => {
      const all = (state.headers.get('cookie') ?? '')
        .split(/;\s*/)
        .filter(Boolean)
        .map((c) => ({ name: c.split('=')[0]!, value: c.split('=').slice(1).join('=') }))
      return { get: (name: string) => all.find((c) => c.name === name), getAll: () => all, has: (name: string) => all.some((c) => c.name === name) }
    },
  })
  return Object.assign(state, { headersModule })
})
vi.mock('next/headers.js', () => next.headersModule())
vi.mock('next/headers', () => next.headersModule())
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    next.navigations.push(`redirect ${url}`)
    throw new Error(`redirect ${url}`)
  },
  notFound: () => {
    next.navigations.push('notFound')
    throw new Error('notFound')
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))
vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: unknown }) => children }))
vi.mock('@payloadcms/ui', async () => {
  const React = await import('react')
  return { Button: ({ children }: { children: unknown }) => React.createElement('button', { type: 'button' }, children as never) }
})

type U = { id: string; email: string; role: string; name: string }
type Jar = Record<string, string>
const PW = 'correct-horse-battery'
let config: Promise<SanitizedConfig>
let payload: Payload
let mongo: MongoMemoryReplSet
let admin: U
let admin2: U
let member: U
/** Everyone's names and emails: none may show up where a component refuses. */
let identities: string[]

const allowAdmins = ({ user }: MasqPermissionArgs) => user.role === 'admin'
const opts = () => payload.config.custom!.masq as { canMasquerade: (a: unknown) => boolean }
const cookieHeader = (jar: Jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
const jarOf = (res: Response) =>
  Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0]!.split('=')).map(([k, ...v]) => [k!, v.join('=')]))

function rest(method: string, path: string, jar: Jar, body?: unknown) {
  const request = new Request(`http://localhost:3000/api${path}`, {
    method,
    headers: { cookie: cookieHeader(jar), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handleEndpoints({ config, request })
}

async function signIn(u: U): Promise<Jar> {
  const res = await rest('POST', '/users/login', {}, { email: u.email, password: PW })
  return { 'payload-token': jarOf(res)['payload-token']! }
}

/** An admin's browser cookies after starting a masquerade over REST. */
async function masquerade(as: U, by = admin): Promise<Jar> {
  const res = await rest('POST', `/users/${as.id}/masq`, await signIn(by), {})
  expect(res.status).toBe(200)
  const set = jarOf(res)
  return { 'payload-token': set['payload-token']!, [STATE_COOKIE]: set[STATE_COOKIE]! }
}

/** Awaits a Server Component's result, unwrapping a top-level async component as RSC would, then renders it to HTML. */
async function html(node: ReactElement | null | Promise<ReactElement | null>): Promise<string> {
  let el = await node
  while (el && typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction')
    el = await (el.type as (props: unknown) => Promise<ReactElement | null>)(el.props)
  return el ? renderToStaticMarkup(el) : ''
}

/** Renders every Server Component for a browser carrying `jar`, as Payload's admin would call them. */
async function render(jar: Jar, target: U = member) {
  next.headers = new Headers({ cookie: cookieHeader(jar) })
  const { user } = await payload.auth({ headers: next.headers })
  const req = (await createLocalReq({ user: (user ?? undefined) as never }, payload)) as PayloadRequest
  if (!user) req.user = null
  ;(req as { headers: Headers }).headers = next.headers
  const doc = (await payload.findByID({ collection: 'users', id: target.id, depth: 0 })) as unknown as Record<string, unknown>
  return {
    banner: await html(MasqueradeBanner({ payload })),
    adminBanner: await html(AdminMasqueradeBanner({ payload })),
    field: await html(MasqueradeField({ payload, req, id: target.id, data: doc })),
    cell: await html(MasqueradeCell({ payload, rowData: doc })),
    navLink: await html(MasqueradeNavLink({ payload, user: user ?? undefined })),
    view: await html(MasqueradeView({ initPageResult: { req, permissions: {}, visibleEntities: {}, locale: undefined }, params: {}, searchParams: {} } as never)),
  }
}

/** Nothing but the refusal: no buttons, no search, and nobody's name or email. */
function expectRefused(out: Awaited<ReturnType<typeof render>>, { banner = '' }: { banner?: string } = {}) {
  expect(out.field).toBe('')
  expect(out.cell).toBe('')
  expect(out.navLink).toBe('')
  expect(out.view).not.toContain('Find a user')
  expect(out.view).not.toContain('<input')
  if (banner) expect(out.banner).toContain(banner)
  else expect(out.banner).toBe('')
  expect(out.adminBanner).toBe(out.banner)
  for (const part of Object.values(out)) for (const who of identities) expect(part).not.toContain(who)
}

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  config = buildConfig({
    secret: 'rsc-test-secret-not-for-production',
    telemetry: false,
    typescript: { autoGenerate: false },
    db: mongooseAdapter({ url: mongo.getUri('masq-rsc'), ensureIndexes: true }),
    collections: [{ slug: 'users', auth: true, fields: [{ name: 'role', type: 'select', options: ['admin', 'member'], defaultValue: 'member' }, { name: 'name', type: 'text' }] }],
    plugins: [masqPlugin({ canMasquerade: allowAdmins, labelField: 'name' })],
  })
  payload = await getPayload({ config })
  const make = (email: string, role: string, name: string) =>
    payload.create({ collection: 'users', data: { email, password: PW, role, name } as never }) as unknown as Promise<U>
  admin = await make('rsc-admin@example.com', 'admin', 'Ada Admin')
  admin2 = await make('rsc-admin2@example.com', 'admin', 'Bea Admin')
  member = await make('rsc-member@example.com', 'member', 'Cy Member')
  identities = [admin, admin2, member].flatMap((u) => [u.name, u.email])
}, 120_000)

beforeEach(() => {
  opts().canMasquerade = allowAdmins as never
  next.navigations.length = 0
})

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

describe('Server Components refuse', () => {
  it('signed-out people', async () => {
    const out = await render({})
    expectRefused(out)
    expect(out.view).toContain('You don’t have permission to masquerade.')
  })

  it('signed-out people holding a leftover state cookie: the banner offers the way back but names nobody', async () => {
    const jar = await masquerade(member)
    const out = await render({ [STATE_COOKIE]: jar[STATE_COOKIE]! })
    expectRefused(out, { banner: 'Your masquerade has ended.' })
    expect(out.banner).toContain('Return to my account')
  })

  it('people who may not masquerade', async () => {
    const out = await render(await signIn(member), admin)
    expectRefused(out)
    expect(out.view).toContain('You don’t have permission to masquerade.')
  })

  it('an admin whose permission was removed', async () => {
    const jar = await signIn(admin)
    expect((await render(jar)).field).toContain('Masquerade as this user')
    opts().canMasquerade = (() => false) as never
    expectRefused(await render(jar))
  })

  it('a masquerader whose permission was removed mid-session: the banner stops naming the target', async () => {
    const jar = await masquerade(member)
    expect((await render(jar)).banner).toContain('Cy Member')
    opts().canMasquerade = (() => false) as never
    const out = await render(jar)
    expectRefused(out, { banner: 'You may no longer masquerade as this user.' })
    expect(out.banner).toContain('Return to my account')
  })

  it('a masquerade whose borrowed session is over, or that someone else is signed in under', async () => {
    const jar = await masquerade(member)
    // The borrowed session has ended (the token is gone) but the state cookie remains.
    expectRefused(await render({ [STATE_COOKIE]: jar[STATE_COOKIE]! }), { banner: 'Your masquerade has ended.' })
    // A different, real account signed in alongside a state cookie meant for the target.
    expectRefused(await render({ ...(await signIn(admin2)), [STATE_COOKIE]: jar[STATE_COOKIE]! }), { banner: 'Your masquerade has ended.' })
  })

  it('a tampered state cookie', async () => {
    const real = (await masquerade(member))[STATE_COOKIE]!
    const [, sig] = real.split('.')
    const state = { by: admin.id, as: admin2.id, at: new Date().toISOString(), until: new Date(Date.now() + 3600_000).toISOString() }
    const forgedBody = `${Buffer.from(JSON.stringify(state)).toString('base64url')}.${sig}`
    const otherSecret = encodeState('not-the-secret', state)
    for (const bad of [forgedBody, otherSecret, 'garbage', `${real}x`]) {
      expectRefused(await render({ [STATE_COOKIE]: bad }))
      expectRefused(await render({ ...(await signIn(member)), [STATE_COOKIE]: bad }), {})
    }
    // A tampered cookie neither grants nor hides anything for a real admin: it is ignored.
    const out = await render({ ...(await signIn(admin)), [STATE_COOKIE]: forgedBody })
    expect(out.banner).toBe('')
    expect(out.field).toContain('Masquerade as this user')
  })
})

describe('Server Components render for an allowed admin', () => {
  it('the account-page button, list cell, nav link and search view, but no banner', async () => {
    const out = await render(await signIn(admin))
    expect(out.banner).toBe('')
    expect(out.field).toContain('Masquerade as this user')
    expect(out.field).toContain('for 60 minutes, read-only')
    expect(out.cell).toContain('Masquerade')
    expect(out.navLink).toContain('href="/admin/masquerade"')
    expect(out.view).toContain('Find a user')
    expect(out.view).not.toContain('You don’t have permission')
    expect(next.navigations).toEqual([])
  })

  it('no button on their own account', async () => {
    const out = await render(await signIn(admin), admin)
    expect(out.field).toBe('')
    expect(out.cell).toBe('')
  })

  it('while masquerading: a banner naming the target, and no way to nest', async () => {
    const jar = await masquerade(admin2)
    const out = await render(jar, member)
    expect(out.banner).toContain('You’re masquerading as <strong>Bea Admin</strong> (rsc-admin2@example.com), read-only.')
    expect(out.banner).toMatch(/Ends in (59|60) min\./)
    expect(out.banner).toContain('Return to my account')
    expect(out.adminBanner).toBe(out.banner)
    expect(out.banner).not.toContain('Ada Admin')
    expect(out.field).toBe('')
    expect(out.cell).toBe('')
    expect(out.navLink).toBe('')
    expect(out.view).toContain('Return to your own account before you masquerade as someone else.')
    expect(out.view).not.toContain('Find a user')
    // Dropping the state cookie hides the banner, but still allows no nesting.
    const dropped = await render({ 'payload-token': jar['payload-token']! }, member)
    expect(dropped.banner).toBe('')
    expect(dropped.field).toBe('')
    expect(dropped.cell).toBe('')
    expect(dropped.navLink).toBe('')
    expect(dropped.view).not.toContain('Find a user')
  })
})
