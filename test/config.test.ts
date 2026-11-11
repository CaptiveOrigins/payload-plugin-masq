import type { CollectionBeforeOperationHook, Config, GlobalBeforeChangeHook } from 'payload'
import { describe, expect, it } from 'vitest'

import { decodeState, encodeState } from '../src/state.js'
import { assertNotMasquerading, masqPlugin, masqueraderOf } from '../src/index.js'

const base = { collections: [{ slug: 'users', auth: true, fields: [] }, { slug: 'notes', fields: [] }] } as unknown as Config

describe('options', () => {
  it('refuses writes while masquerading in read-only mode, except its own', async () => {
    const config = masqPlugin({ canMasquerade: () => true })(base) as Config // read-only by default
    const hook = config.collections!.find((c) => c.slug === 'notes')!.hooks!.beforeOperation!.at(-1) as CollectionBeforeOperationHook
    const secret = 's'
    const state = encodeState(secret, { by: 'a', as: 'b', at: new Date().toISOString(), until: new Date().toISOString() })
    const req = (cookie: string, context = {}) => ({ payload: { secret }, headers: new Headers({ cookie }), context }) as never
    expect(() => hook({ args: {}, operation: 'update', req: req(`payload-masq=${state}`) } as never)).toThrow(/read-only/)
    expect(hook({ args: { ok: 1 }, operation: 'read', req: req(`payload-masq=${state}`) } as never)).toEqual({ ok: 1 })
    expect(hook({ args: { ok: 1 }, operation: 'update', req: req('') } as never)).toEqual({ ok: 1 })
    expect(hook({ args: { ok: 1 }, operation: 'update', req: req(`payload-masq=${state}`, { masqInternal: true }) } as never)).toEqual({ ok: 1 })
  })

  it('leaves Payload bookkeeping writable and can be turned off', () => {
    const withPrefs = { ...base, collections: [...base.collections!, { slug: 'payload-preferences', fields: [] }] } as Config
    const on = masqPlugin({ canMasquerade: () => true })(withPrefs) as Config
    expect(on.collections!.find((c) => c.slug === 'payload-preferences')!.hooks?.beforeOperation ?? []).toHaveLength(0)
    const off = masqPlugin({ canMasquerade: () => true, readOnly: false })(base) as Config
    expect(off.collections!.find((c) => c.slug === 'notes')!.hooks?.beforeOperation ?? []).toHaveLength(0)
  })

  it('adds nothing when disabled, and refuses a missing collection', () => {
    expect(masqPlugin({ canMasquerade: () => true, enabled: false })(base)).toBe(base)
    expect(() => masqPlugin({ canMasquerade: () => true, collection: 'admins' })(base)).toThrow(/no collection/)
  })
})

describe('state and read-only edges', () => {
  const secret = 's'
  const state = { by: 'a', as: 'b', at: new Date().toISOString(), until: new Date().toISOString() }

  it('rejects a tampered, re-signed-with-another-secret or malformed state', () => {
    const good = encodeState(secret, state)
    expect(decodeState(secret, good)).toEqual(state)
    const [, sig] = good.split('.')
    const otherBody = Buffer.from(JSON.stringify({ ...state, by: 'z' })).toString('base64url')
    expect(decodeState(secret, `${otherBody}.${sig}`)).toBeNull()
    expect(decodeState('other-secret', good)).toBeNull()
    expect(decodeState(secret, 'no-dot')).toBeNull()
    expect(decodeState(secret, '')).toBeNull()
    expect(decodeState(secret, encodeState(secret, { by: 'a' } as never))).toBeNull()
  })

  it('refuses deletes and global writes while masquerading', () => {
    const withGlobal = { ...base, globals: [{ slug: 'site', fields: [] }] } as unknown as Config
    const config = masqPlugin({ canMasquerade: () => true })(withGlobal) as Config
    const cookie = `payload-masq=${encodeState(secret, state)}`
    const req = { payload: { secret }, headers: new Headers({ cookie }), context: {} } as never
    const op = config.collections!.find((c) => c.slug === 'notes')!.hooks!.beforeOperation!.at(-1) as CollectionBeforeOperationHook
    expect(() => op({ args: {}, operation: 'delete', req } as never)).toThrow(/read-only/)
    const g = config.globals!.find((x) => x.slug === 'site')!.hooks!.beforeChange!.at(-1) as GlobalBeforeChangeHook
    expect(() => g({ data: {}, req } as never)).toThrow(/read-only/)
    expect(g({ data: { ok: 1 }, req: { ...(req as object), headers: new Headers() } } as never)).toEqual({ ok: 1 })
    const off = masqPlugin({ canMasquerade: () => true, readOnly: false })(withGlobal) as Config
    expect(off.globals!.find((x) => x.slug === 'site')!.hooks?.beforeChange ?? []).toHaveLength(0)
  })

  it('assertNotMasquerading allows writes when read-only is off; masqueraderOf is null without a masquerade', () => {
    const cookie = new Headers({ cookie: `payload-masq=${encodeState(secret, state)}` })
    expect(() => assertNotMasquerading({ secret, config: { custom: { masq: { readOnly: false } } } } as never, cookie)).not.toThrow()
    expect(() => assertNotMasquerading({ secret, config: { custom: { masq: { readOnly: true } } } } as never, cookie)).toThrow(/read-only/)
    expect(masqueraderOf({ payload: { secret } as never, headers: new Headers() })).toBeNull()
    expect(masqueraderOf({ payload: { secret } as never, headers: cookie })).toBe('a')
  })
})
