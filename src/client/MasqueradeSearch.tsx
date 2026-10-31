'use client'

import React, { useEffect, useState } from 'react'

import { MasqueradeButton } from './MasqueradeButton.js'

type Row = { id: string; label: string; email: string | null; allowed: boolean }

async function start(apiPath: string, id: string, reason: string | null) {
  const res = await fetch(`${apiPath}/${encodeURIComponent(id)}/masq`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  const body = (await res.json().catch(() => null)) as { redirect?: string; errors?: { message: string }[] } | null
  if (res.ok) window.location.assign(body?.redirect ?? '/')
  return res.ok ? null : (body?.errors?.[0]?.message ?? 'Could not start masquerading.')
}

/** "Masquerade as…": type a name, pick a suggestion (or press Enter for the first), and go. */
export function QuickMasquerade({ apiPath, requireReason }: { apiPath: string; requireReason: boolean }) {
  const [q, setQ] = useState('')
  const [reason, setReason] = useState('')
  const [options, setOptions] = useState<Row[]>([])
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!q.trim()) return setOptions([])
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      const res = await fetch(`${apiPath}/masq/search?q=${encodeURIComponent(q)}`, { credentials: 'include', signal: ctrl.signal }).catch(() => null)
      if (res?.ok) setOptions(((await res.json()) as { docs: Row[] }).docs.filter((r) => r.allowed).slice(0, 8))
      setActive(0)
    }, 200)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, apiPath])
  const go = async (row: Row | undefined) => {
    if (!row) return
    if (requireReason && !reason.trim()) return setError('Say why you are masquerading.')
    setError(await start(apiPath, row.id, reason.trim() || null))
  }
  return (
    <div style={{ display: 'grid', gap: 6, maxWidth: 760, position: 'relative' }}>
      <label htmlFor="masq-quick" style={{ fontWeight: 600 }}>
        Masquerade as…
      </label>
      <input
        id="masq-quick"
        autoFocus
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls="masq-quick-list"
        aria-activedescendant={options[active] ? `masq-opt-${options[active]!.id}` : undefined}
        autoComplete="off"
        placeholder="Start typing a name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1))
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          else if (e.key === 'Enter') {
            e.preventDefault()
            void go(options[active])
          } else return
          e.preventDefault()
        }}
        style={{ padding: '0.6rem 0.8rem', fontSize: '1rem' }}
      />
      {requireReason && <input placeholder="Reason (e.g. support ticket)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
      {options.length > 0 && (
        <ul id="masq-quick-list" role="listbox" style={{ listStyle: 'none', margin: 0, padding: 4, border: '1px solid var(--theme-elevation-150)', borderRadius: 4, background: 'var(--theme-elevation-0)' }}>
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`masq-opt-${o.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                void go(o)
              }}
              style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 3, background: i === active ? 'var(--theme-elevation-100)' : undefined }}
            >
              {o.label}
              {o.email && o.email !== o.label && <span style={{ color: 'var(--theme-elevation-500)' }}> · {o.email}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <p style={{ color: 'var(--theme-error-500)', margin: 0 }}>{error}</p>}
    </div>
  )
}

/** Admin user search for masquerading (results come from the access-checked search endpoint). */
export function MasqueradeSearch({ apiPath, adminRoute, collection, requireReason }: { apiPath: string; adminRoute: string; collection: string; requireReason: boolean }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setState('loading')
      try {
        const res = await fetch(`${apiPath}/masq/search?q=${encodeURIComponent(q)}`, { credentials: 'include', signal: ctrl.signal })
        if (!res.ok) throw new Error(String(res.status))
        setRows(((await res.json()) as { docs: Row[] }).docs)
        setState('idle')
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setState('error')
      }
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, apiPath])
  return (
    <div style={{ display: 'grid', gap: 'var(--base)', maxWidth: 760 }}>
      <input type="search" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: '0.6rem 0.8rem', fontSize: '1rem' }} aria-label="Search users" />
      {state === 'error' && <p style={{ color: 'var(--theme-error-500)' }}>Search failed.</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--theme-elevation-100)', paddingBottom: 8 }}>
            <span>
              <a href={`${adminRoute}/collections/${collection}/${r.id}`}>{r.label}</a>
              {r.email && r.email !== r.label && <span style={{ color: 'var(--theme-elevation-500)' }}> · {r.email}</span>}
            </span>
            {r.allowed ? <MasqueradeButton apiPath={apiPath} userId={r.id} requireReason={requireReason} label="Masquerade" /> : <span style={{ color: 'var(--theme-elevation-500)' }}>Not allowed</span>}
          </li>
        ))}
        {state === 'idle' && rows.length === 0 && <li style={{ color: 'var(--theme-elevation-500)' }}>No users found.</li>}
      </ul>
    </div>
  )
}
