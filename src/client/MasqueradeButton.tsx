'use client'

import { Button } from '@payloadcms/ui'
import React, { useState } from 'react'

type Props = { apiPath: string; userId: string; requireReason?: boolean; label?: string; size?: 'small' | 'medium'; hint?: string | null }

/** Starts masquerading as a user (asks for a reason when the plugin requires one). */
export function MasqueradeButton({ apiPath, userId, requireReason = false, label = 'Masquerade as this user', size = 'small', hint }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const start = async () => {
    if (requireReason && !reason.trim()) return setError('Say why you are masquerading.')
    setBusy(true)
    setError(null)
    const res = await fetch(`${apiPath}/${encodeURIComponent(userId)}/masq`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() || null }),
    })
    const body = (await res.json().catch(() => null)) as { redirect?: string; errors?: { message: string }[] } | null
    if (res.ok) {
      window.location.assign(body?.redirect ?? '/')
      return
    }
    setError(body?.errors?.[0]?.message ?? 'Could not start masquerading.')
    setBusy(false)
  }
  return (
    <div className="masq-button" style={{ display: 'grid', gap: 6, marginBottom: 'var(--base)' }}>
      {requireReason && (
        <input className="masq-button__reason" placeholder="Reason (e.g. support ticket)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      )}
      <Button buttonStyle="secondary" size={size} disabled={busy} onClick={start} margin={false}>
        {busy ? 'Starting…' : label}
      </Button>
      {hint && <p style={{ color: 'var(--theme-elevation-500)', fontSize: '0.85em', margin: 0 }}>{hint}</p>}
      {error && <p style={{ color: 'var(--theme-error-500)', margin: 0 }}>{error}</p>}
    </div>
  )
}
