# payload-plugin-masq

Masquerade for [Payload](https://payloadcms.com) 3: an admin signs in as another user to see
the site and admin exactly as they do, then returns to their own account with one click.
Built for support and troubleshooting.

> **Beta (0.x).** Used in production by Captive Origins. Feedback and issues welcome.

## What you get

- **Masquerade as this user**: a button on each account page, shown only to people allowed
  to masquerade as that user.
- **Masquerade area** (`/admin/masquerade`): a "Masquerade as…" autocomplete for quick
  switching, plus a user search with a Masquerade button on every result. Only people allowed to
  masquerade see it, and the search reads with their own access, so it never lists anyone
  they could not already see. The users list gets a Masquerade column with a button per row.
- **A banner** in the admin (and on your site, with `<MasqueradeBanner />`): who you are
  masquerading as, the time left, and **Return to my account**. Once the borrowed session is
  over, or you're no longer allowed to masquerade as that user, it names nobody and only offers
  the way back.
- **A real, short session**: the masquerader gets a genuine Payload session of the target
  (the same mechanism as a normal login, sessions included), so every access rule applies
  exactly as for that user. One hour by default, and it can't be refreshed past that.
- **Safe return**: your own token waits in an httpOnly cookie sent only to the stop endpoint,
  and comes back only if it is still valid and you are still allowed to masquerade. The
  borrowed session is ended when you return.
- **Audit hooks**: `onStart` (with an optional reason) and `onStop`, and `masqueraderOf(req)`
  so your audit trail can record who really made a change.
- **Read-only** (default): look everywhere the user can, but nothing can be created, changed
  or deleted while masquerading, over REST, GraphQL or the Local API with the request. The
  borrowed token itself is marked, so clearing the masquerade cookie doesn't lift it. Payload's own bookkeeping (preferences, document locks) keeps
  working. Writes in your own server actions: call `assertNotMasquerading(payload, headers)`.
- Never as yourself, no nesting, no public endpoints: masquerading needs a signed-in user the
  rules allow.

## On its own, and with others

**On its own:** it needs an auth collection (default `users`) and your `canMasquerade`. It works with no other Captive Origins plugin. Auditing is up to your `onStart` and `onStop`.

**Works with:**
- **Audit Trail:** call Audit Trail's `recordEvent` from `onStart` and `onStop` (with `masquerade` in its `actions`), and use `masqueraderOf(req)` in its `via` so a change made while masquerading says who really made it.
- **Hats:** as Hats' design describes, Hats' `blocked(req)` refuses switching while masquerading, and your `canMasquerade` refuses a switched session (`hatsStateOf(user).via`).

**Family:** It's part of the **Identity** family (a working draft): plugins designed to sit together for accounts and access.

## Install

```bash
npm install @captiveorigins/payload-plugin-masq
```

```ts
import { masqPlugin } from '@captiveorigins/payload-plugin-masq'

export default buildConfig({
  plugins: [
    masqPlugin({
      // Required. Who may masquerade (target absent = may they use masquerade at all).
      canMasquerade: ({ user, target }) => user.role === 'admin',
      onStart: async ({ req, masquerader, target, reason }) => {
        await req.payload.create({
          collection: 'audit-log',
          data: { action: 'masquerade-start', by: masquerader.id, user: target.id, reason },
          req,
        })
      },
      onStop: async ({ req, masqueraderId, targetId, expired }) => {
        /* … */
      },
    }),
  ],
})
```

Then run `payload generate:importmap`. Add the banner to your site layout (a Server
Component) so masqueraders see it outside the admin too:

```tsx
import { MasqueradeBanner } from '@captiveorigins/payload-plugin-masq/rsc'

<MasqueradeBanner payload={payload} />
```

## Options

| Option | Default | |
|---|---|---|
| `canMasquerade` | (required) | `({ payload, user, target? }) => boolean`. No default: nobody can masquerade until you decide. |
| `collection` | `'users'` | Auth collection. |
| `duration` | `3600` | Seconds the borrowed session lasts. |
| `readOnly` | `true` | Refuse create, update and delete while masquerading. |
| `requireReason` | `false` | Ask for a reason; passed to `onStart`. |
| `labelField` | `'email'` | Name shown in the search and banner. |
| `searchFields` | `['email']` | Fields the search matches. |
| `startPath` | admin route | Where to go after starting. |
| `adminBanner` | `true` | Banner in the admin header. |
| `adminView` | `true` | Masquerade area and nav link. |
| `listColumn` | `true` | Masquerade column in the users list (added to `defaultColumns`). |
| `onStart`, `onStop` | | Audit hooks. |
| `enabled` | `true` | |

## Endpoints

On the auth collection (`/api/users/…`): `POST /:id/masq` (start, body `{ reason? }`),
`POST /masq/stop` (return) and `GET /masq/search?q=` (admin search). All need a signed-in
user that `canMasquerade` allows.

## Acknowledgements

[payload-plugin-masquerade](https://github.com/manutepowa/payload-plugin-masquerade) came first
and is worth a look. We built this one because our direction differed in ways too large to
merge: a short borrowed session that ends on return, restore only for a still-valid masquerader,
an access-checked admin-only search, a banner on the site as well as the admin, and audit hooks.

## License

MIT
