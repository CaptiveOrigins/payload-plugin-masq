'use client'

import React, { useState } from 'react'

/** Stops masquerading and returns to the masquerader's own account. */
export function ReturnButton({ stopPath, label = 'Return to my account', style }: { stopPath: string; label?: string; style?: React.CSSProperties }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      style={{ border: '1px solid rgba(255,255,255,0.7)', background: '#fff', color: '#7c2d12', borderRadius: 6, padding: '0.25rem 0.75rem', fontWeight: 600, cursor: 'pointer', ...style }}
      onClick={async () => {
        setBusy(true)
        const res = await fetch(stopPath, { method: 'POST', credentials: 'include' })
        const body = (await res.json().catch(() => null)) as { redirect?: string } | null
        window.location.assign(body?.redirect ?? '/')
      }}
    >
      {busy ? 'Returning…' : label}
    </button>
  )
}
