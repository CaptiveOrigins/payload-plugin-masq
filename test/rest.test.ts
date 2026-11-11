import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { GRAPHQL_POST } from '@payloadcms/next/routes'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, handleEndpoints, type Payload, type SanitizedConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { masqPlugin, STATE_COOKIE } from '../src/index.js'
import { READ_ONLY_MESSAGE } from '../src/plugin.js'

// Read-only masquerade through real HTTP requests: Payload's own REST router
// (`handleEndpoints`, what `@payloadcms/next/routes` serves) and its GraphQL route.

type U = { id: string; email: string; role: string }
const PW = 'correct-horse-battery'
let config: Promise<SanitizedConfig>
let payload: Payload
let mongo: MongoMemoryReplSet
let admin: U
let member: U
let noteId: string

type Jar = Record<string, string>
const cookieHeader = (jar: Jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
const jarOf = (res: Response) =>
  Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0]!.split('=')).map(([k, ...v]) => [k!, v.join('=')]))

/** A browser-like request to the REST API, signed in by the cookies in `jar`. */
function rest(method: string, path: string, jar: Jar, body?: unknown) {
  const headers = new Headers({ cookie: cookieHeader(jar) })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const request = new Request(`http://localhost:3000/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return handleEndpoints({ config, request })
}

/** A GraphQL request, signed in by the cookies in `jar`. */
async function gql(query: string, jar: Jar) {
  const request = new Request('http://localhost:3000/api/graphql', {
    method: 'POST',
    headers: { cookie: cookieHeader(jar), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return (await (await GRAPHQL_POST(config)(request)).json()) as { data?: Record<string, unknown>; errors?: { message: string }[] }
}

async function signIn(u: U): Promise<Jar> {
  const res = await rest('POST', '/users/login', {}, { email: u.email, password: PW })
  expect(res.status).toBe(200)
  return { 'payload-token': jarOf(res)['payload-token']! }
}

/** Starts a masquerade over REST and returns the browser's cookies afterwards. */
async function masquerade(as: U): Promise<Jar> {
  const own = await signIn(admin)
  const res = await rest('POST', `/users/${as.id}/masq`, own, {})
  expect(res.status).toBe(200)
  const set = jarOf(res)
  return { 'payload-token': set['payload-token']!, [STATE_COOKIE]: set[STATE_COOKIE]! }
}

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  config = buildConfig({
    secret: 'rest-test-secret-not-for-production',
    telemetry: false,
    typescript: { autoGenerate: false },
    db: mongooseAdapter({ url: mongo.getUri('masq-rest'), ensureIndexes: true }),
    collections: [
      { slug: 'users', auth: true, access: { read: () => true, update: () => true }, fields: [{ name: 'role', type: 'select', options: ['admin', 'member'], defaultValue: 'member' }, { name: 'name', type: 'text' }] },
      { slug: 'notes', access: { create: () => true, read: () => true, update: () => true, delete: () => true }, fields: [{ name: 'text', type: 'text' }] },
    ],
    globals: [{ slug: 'settings', access: { read: () => true, update: () => true }, fields: [{ name: 'motto', type: 'text' }] }],
    plugins: [masqPlugin({ canMasquerade: ({ user }) => user.role === 'admin' })],
  })
  payload = await getPayload({ config })
  const make = (email: string, role: string, name: string) =>
    payload.create({ collection: 'users', data: { email, password: PW, role, name } as never }) as unknown as Promise<U>
  admin = await make('rest-admin@example.com', 'admin', 'Ada Admin')
  member = await make('rest-member@example.com', 'member', 'Cy Member')
  noteId = String((await payload.create({ collection: 'notes', data: { text: 'original' } })).id)
  await payload.updateGlobal({ slug: 'settings', data: { motto: 'original' } })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

const errorOf = async (res: Response) => ((await res.json()) as { errors?: { message: string }[] }).errors?.[0]?.message

describe('read-only over REST', () => {
  it('lets the same requests write when nobody is masquerading (control)', async () => {
    const jar = await signIn(member)
    const created = await rest('POST', '/notes', jar, { text: 'control' })
    expect(created.status).toBe(201)
    const id = ((await created.json()) as { doc: { id: string } }).doc.id
    expect((await rest('PATCH', `/notes/${id}`, jar, { text: 'control 2' })).status).toBe(200)
    expect((await rest('DELETE', `/notes/${id}`, jar)).status).toBe(200)
    expect((await rest('POST', '/globals/settings', jar, { motto: 'original' })).status).toBe(200)
  })

  it('refuses creates, updates and deletes on collections and globals while masquerading', async () => {
    const jar = await masquerade(member)
    const tries = [
      rest('POST', '/notes', jar, { text: 'new' }),
      rest('PATCH', `/notes/${noteId}`, jar, { text: 'changed' }),
      rest('PATCH', `/notes?where[id][equals]=${noteId}`, jar, { text: 'changed in bulk' }),
      rest('DELETE', `/notes/${noteId}`, jar),
      rest('DELETE', `/notes?where[id][equals]=${noteId}`, jar),
      rest('PATCH', `/users/${member.id}`, jar, { name: 'Changed' }),
      rest('POST', '/globals/settings', jar, { motto: 'changed' }),
    ]
    for (const res of await Promise.all(tries)) {
      const message = await errorOf(res.clone())
      // Bulk operations report per-document errors with a 400; single ones a 403.
      expect([400, 403]).toContain(res.status)
      expect(JSON.stringify(await res.json())).toContain(READ_ONLY_MESSAGE)
      expect(message).toBeTruthy()
    }
    const note = await payload.findByID({ collection: 'notes', id: noteId })
    expect(note.text).toBe('original')
    expect((await payload.findGlobal({ slug: 'settings' })).motto).toBe('original')
    expect(((await payload.findByID({ collection: 'users', id: member.id })) as unknown as { name: string }).name).toBe('Cy Member')
    expect((await payload.count({ collection: 'notes', where: { text: { equals: 'new' } } })).totalDocs).toBe(0)
  })

  it('still reads, as the target', async () => {
    const jar = await masquerade(member)
    const me = await rest('GET', '/users/me', jar)
    expect(((await me.json()) as { user: { id: string } }).user.id).toBe(member.id)
    const list = await rest('GET', '/notes', jar)
    expect(list.status).toBe(200)
    expect(((await list.json()) as { docs: { id: string }[] }).docs.map((d) => d.id)).toContain(noteId)
    expect((await rest('GET', `/notes/${noteId}`, jar)).status).toBe(200)
    expect(((await (await rest('GET', '/globals/settings', jar)).json()) as { motto: string }).motto).toBe('original')
  })

  it('stays read-only when the browser drops the state cookie but keeps the borrowed session', async () => {
    const jar = await masquerade(member)
    const borrowed = { 'payload-token': jar['payload-token']! }
    expect(((await (await rest('GET', '/users/me', borrowed)).json()) as { user: { id: string } }).user.id).toBe(member.id)
    const tries = [
      rest('POST', '/notes', borrowed, { text: 'sneaky' }),
      rest('PATCH', `/notes/${noteId}`, borrowed, { text: 'sneaky' }),
      rest('DELETE', `/notes/${noteId}`, borrowed),
      rest('POST', '/globals/settings', borrowed, { motto: 'sneaky' }),
    ]
    for (const res of await Promise.all(tries)) {
      expect(res.status).toBe(403)
      expect(await errorOf(res)).toBe(READ_ONLY_MESSAGE)
    }
    expect((await payload.findByID({ collection: 'notes', id: noteId })).text).toBe('original')
    expect((await payload.findGlobal({ slug: 'settings' })).motto).toBe('original')
  })

  it('does not let the borrowed session be refreshed past its hour', async () => {
    for (const jar of [await masquerade(member), { 'payload-token': (await masquerade(member))['payload-token']! }]) {
      const res = await rest('POST', '/users/refresh-token', jar)
      expect(res.status).toBe(403)
      expect(jarOf(res)['payload-token']).toBeUndefined()
    }
    // A normal session still refreshes.
    expect((await rest('POST', '/users/refresh-token', await signIn(member))).status).toBe(200)
  })

  it('returns over REST, after which writes work again', async () => {
    const own = await signIn(admin)
    const started = jarOf(await rest('POST', `/users/${member.id}/masq`, own, {}))
    const back = await rest('POST', '/users/masq/stop', started)
    expect(await back.json()).toMatchObject({ restored: true })
    const restored = { 'payload-token': jarOf(back)['payload-token']! }
    expect(restored['payload-token']).toBe(own['payload-token'])
    expect(jarOf(back)[STATE_COOKIE]).toBe('')
    const created = await rest('POST', '/notes', restored, { text: 'after return' })
    expect(created.status).toBe(201)
  })
})

describe('read-only over GraphQL', () => {
  it('refuses mutations on collections and globals, and still answers queries', async () => {
    const jar = await masquerade(member)
    const mutations = [
      'mutation { createNote(data: { text: "new" }) { id } }',
      `mutation { updateNote(id: "${noteId}", data: { text: "changed" }) { id } }`,
      `mutation { deleteNote(id: "${noteId}") { id } }`,
      `mutation { updateUser(id: "${member.id}", data: { name: "Changed" }) { id } }`,
      'mutation { updateSetting(data: { motto: "changed" }) { motto } }',
    ]
    for (const query of mutations) {
      const res = await gql(query, jar)
      expect(res.errors?.[0]?.message).toBe(READ_ONLY_MESSAGE)
    }
    // Without the state cookie too.
    const dropped = await gql('mutation { createNote(data: { text: "sneaky" }) { id } }', { 'payload-token': jar['payload-token']! })
    expect(dropped.errors?.[0]?.message).toBe(READ_ONLY_MESSAGE)

    expect((await payload.findByID({ collection: 'notes', id: noteId })).text).toBe('original')
    expect((await payload.findGlobal({ slug: 'settings' })).motto).toBe('original')

    const read = await gql(`{ Notes { docs { id text } } Setting { motto } meUser { user { id } } }`, jar)
    expect(read.errors).toBeUndefined()
    expect(read.data).toMatchObject({ Setting: { motto: 'original' }, meUser: { user: { id: member.id } } })
    expect((read.data!.Notes as { docs: { id: string }[] }).docs.map((d) => d.id)).toContain(noteId)
  })

  it('lets the same mutation through when nobody is masquerading (control)', async () => {
    const res = await gql('mutation { createNote(data: { text: "gql control" }) { id } }', await signIn(member))
    expect(res.errors).toBeUndefined()
  })
})
