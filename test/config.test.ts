import type { CollectionBeforeOperationHook, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { encodeState } from '../src/state.js'
import { masqPlugin } from '../src/index.js'

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
