import type { CollectionBeforeOperationHook, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { encodeState } from '../src/state.js'
import { masqPlugin } from '../src/index.js'

const base = { collections: [{ slug: 'users', auth: true, fields: [] }, { slug: 'notes', fields: [] }] } as unknown as Config

describe('options', () => {
  it('refuses writes while masquerading in read-only mode, except its own', async () => {
    const config = masqPlugin({ canMasquerade: () => true, readOnly: true })(base) as Config
    const hook = config.collections!.find((c) => c.slug === 'notes')!.hooks!.beforeOperation!.at(-1) as CollectionBeforeOperationHook
    const secret = 's'
    const state = encodeState(secret, { by: 'a', as: 'b', at: new Date().toISOString(), until: new Date().toISOString() })
    const req = (cookie: string, context = {}) => ({ payload: { secret }, headers: new Headers({ cookie }), context }) as never
    expect(() => hook({ args: {}, operation: 'update', req: req(`payload-masq=${state}`) } as never)).toThrow(/read-only/)
    expect(hook({ args: { ok: 1 }, operation: 'read', req: req(`payload-masq=${state}`) } as never)).toEqual({ ok: 1 })
    expect(hook({ args: { ok: 1 }, operation: 'update', req: req('') } as never)).toEqual({ ok: 1 })
    expect(hook({ args: { ok: 1 }, operation: 'update', req: req(`payload-masq=${state}`, { masqInternal: true }) } as never)).toEqual({ ok: 1 })
  })

  it('adds nothing when disabled, and refuses a missing collection', () => {
    expect(masqPlugin({ canMasquerade: () => true, enabled: false })(base)).toBe(base)
    expect(() => masqPlugin({ canMasquerade: () => true, collection: 'admins' })(base)).toThrow(/no collection/)
  })
})
