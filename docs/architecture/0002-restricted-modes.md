# 0002: Restricted modes

Status: **design agreed, not built** (2026-11-11). It builds after the current plugin work is done.

## Context

Masquerading is read-only: an admin sees what a user sees and can't change anything. Some sites have accounts that nobody can sign in to any more (an account kept only so its records stay together, say) and need admins to look into them with a stricter trail than usual, and to make a short, fixed list of corrections there.

The owner decided this for his site on 2026-11-11: admins only; a written reason; every view audited; read-only by default; a fixed list of allowed changes, each with its own reason and audited; and a list of things that are never allowed.

Masq stays agnostic. It knows nothing about what makes an account special or what the corrections are: the site says.

## Decision

A site can define **modes**. A mode is a stricter kind of masquerade for the targets it applies to.

```ts
masqPlugin({
  modes: {
    archived: {
      appliesTo: ({ target, req }) => boolean,   // is this target one of these accounts?
      canEnter: ({ req, target }) => boolean,    // who may enter (admins, say)
      reason: 'required',                        // a written reason, kept with the session
      onView: (event) => void,                   // every first read, for the site's audit trail
      allow: [                                   // the only changes that pass
        { key: 'fix-label', collection: 'things', operation: 'update', fields: ['label'], check: ({ req, doc, data }) => boolean },
        { key: 'add-result', collection: 'results', operation: 'create', check: ({ req, data }) => boolean },
        { key: 'hand-over', action: ({ req, target, input }) => Promise<unknown> },
      ],
      never: [{ collection: 'users', fields: ['email', 'password', 'status'] }, { collection: 'secrets' }],
    },
  },
})
```

Rules the plugin enforces, whatever the site passes:

- **One way in.** A target a mode applies to can be entered only in that mode, never by the ordinary masquerade, and only with a reason.
- **Only an exact `true` counts** from `appliesTo`, `canEnter` and every `check`. Anything else, or a throw, refuses. If `appliesTo` throws, the target can't be entered at all.
- **Read-only by default,** enforced by the signed claim on the borrowed session, as today.
- **A change passes only when** it matches one `allow` rule exactly (the collection, the operation, only the listed fields, and `check` says `true`), carries its own written reason, and isn't in `never`. `never` is checked first and can't be overridden.
- **Actions.** A rule with `action` runs the site's own function (a hand-over that has its own rules and records, say). The plugin checks the mode, the reason and `canEnter`, then calls it. The plugin writes nothing itself.
- **Always refused in a mode,** whatever the rules say: deletes, bulk writes, version restores, unlocks, password operations and refresh.
- **Views are reported once per document per session,** on its first read, with who, which target, which document and the session's reason. A list read is one event with the collection and the ids returned. Repeat reads in the same session aren't reported again.
- **Every allowed change is reported** through `onEvent`, with the admin, the target, the rule's key and both reasons.
- **The signed claim names the mode,** so the rules follow the session, not a cookie.

## What stays the site's

- Which accounts a mode applies to, who may enter, the allow list and the never list.
- Stopping such accounts from signing in. That belongs at the site's sign-in check, on every route; Masq can't do it.
- Keeping the audit trail (the Audit Trail plugin's `fromPluginEvent` fits).

## Tests (planned)

- Entering: only through the mode; refused without a reason, for a non-admin, when a function throws or answers anything but `true`.
- Reading: one event per document per session; one per list read; none for repeats.
- Changing: each rule passes only its own collection, operation and fields; an extra field refuses; `never` wins over `allow`; a missing reason refuses; the always-refused operations refuse; an `action` runs only after the checks.
- A forged or missing mode in the claim refuses.
- Through REST and GraphQL as well as the Local API.

## Open

- Whether a mode's session should be shorter than the ordinary hour. The site can set it; the default stays an hour.
