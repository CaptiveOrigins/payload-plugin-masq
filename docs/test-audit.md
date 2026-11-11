# Test audit

Kept by this repo's owning session, per `~/Code/CLAUDE.md`, "Test self-audits". Newest first.

## 2026-11-10: first audit

Suite before: 9 tests. After: 19. Sources: the README, the option docs in `src/types.ts` and the comments in `src/plugin.ts` and `src/endpoints.ts`. There is no `docs/decisions.md`.

| Promise | Test |
| --- | --- |
| Endpoints, Masquerade view, banner, nav link, account-page field and list column are added | `masquerade > adds endpoints…` |
| A real one-hour session of the target; returns to the masquerader; the borrowed session ends on return | `masquerade > borrows a one-hour session…` |
| `onStart` gets the reason; `onStop` gets who, whom, expired, restored; `masqueraderOf(req)` | `masquerade > borrows a one-hour session…`, `refusals > reports an expired…`, `state and read-only edges > assertNotMasquerading…` |
| Never as yourself, no nesting | `masquerade > borrows a one-hour session…` |
| No public endpoints: signed out gets 401 on start and search | `refusals > refuses to start when signed out…`, `masquerade > searches users…` |
| `canMasquerade` decides, per target too; a missing user is 404; no browser sign-in is refused | `masquerade > borrows…` (member refused), `refusals > asks canMasquerade about the target…`, `refusals > refuses to start…` |
| `requireReason` refuses a blank reason | `refusals > asks canMasquerade about the target…` |
| Own token in an httpOnly cookie sent only to the stop endpoint | `refusals > scopes the cookies…` |
| Restore only a still-valid token of the same masquerader who may still masquerade | `masquerade > never restores from a forged state…`, `refusals > does not restore a masquerader who lost permission…`, `refusals > does not restore a valid token that belongs to someone other…` |
| Signed state cookie can't be forged, re-signed or malformed | `state and read-only edges > rejects a tampered…`, `masquerade > never restores from a forged state…` |
| Read-only: create, update, delete and global writes refused; reads work; the plugin's own writes and Payload bookkeeping still work; can be turned off | `options` (2), `masquerade > is read-only…`, `state and read-only edges > refuses deletes and global writes…` |
| `assertNotMasquerading` for server actions, off when read-only is off | `masquerade > is read-only…`, `state and read-only edges > assertNotMasquerading…` |
| Search only for people allowed to masquerade, read with their own access, never lists yourself, marks who they may use | `masquerade > searches users…`, `refusals > search lists only users the masquerader can read…` |
| Admins may masquerade as other admins when the rule says so | `masquerade > lets admins masquerade as other admins` |
| `enabled: false` adds nothing; a missing collection is refused | `options > adds nothing when disabled…` |

### Gaps added

- Start refusals: signed out (401), missing user (404), no browser sign-in, target-level `canMasquerade` refusal (403), blank reason when required.
- Cookie scope: all three httpOnly, the return token's path limited to the stop endpoint.
- Restore refusals: masquerader who lost permission (and is signed out), a valid token of someone else.
- Expired borrowed session reported to `onStop`.
- Search reads with the masquerader's own access; `allowed: false` for targets they may not use.
- State cookie: tampered body, another secret, malformed, missing fields.
- Read-only: deletes and global writes refused, globals untouched when read-only is off; `assertNotMasquerading` with read-only off; `masqueraderOf` without a masquerade.

### Gaps skipped (and why)

- Options that only pass a value through (`labelField` beyond the search label, `startPath`, `duration` other than the default, `adminBanner`, `adminView`, `listColumn` off): plain config wiring, and the defaults are already checked.
- Payload's own session and JWT handling: framework internals.

### For the lead

- The React Server Components (`MasqueradeField`, `MasqueradeCell`, `MasqueradeNavLink`, `MasqueradeView`, `MasqueradeBanner`) each hide themselves from people who may not masquerade, and none of that is tested. It needs a render harness with Next's `headers()` mocked, which is more than a small pass.
- REST and GraphQL writes while masquerading are only tested through the Local API with the request. A test through a real HTTP request would prove the "everywhere Payload runs" claim in the option docs.
