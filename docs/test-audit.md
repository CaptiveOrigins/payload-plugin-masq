# Test audit

Newest first.

## 2026-11-11 (re-read): the masqBy claim must be genuine

The re-read approved 1b4cf61 with one should: the stop endpoint read `masqBy` without checking its signature, so a plain user who sent their real token in `Authorization` and a cookie copy with a forged claim got a false `onStop` entry and lost their own session. The claim now counts only on a token signed with Payload's secret (HS256, as Payload checks its JWTs), and stop uses it only when the token signs in the user the request is authenticated as. Suite: 47 → 49.

| Promise | Test |
| --- | --- |
| A forged claim records nothing and ends nothing | `the masqBy claim must be genuine > a forged claim…` |
| A genuine borrowed token of someone else, beside a real sign-in, records nothing and ends nothing | `…a genuine borrowed token of someone else…` |

Mutation checks: signature not checked, 1 failure; claim not matched to the signed-in user, 1 (it survived until the second test was added). README notes added: a leftover masquerade cookie (up to 24 hours) makes forgot-password answer 403 until Return or expiry; the upgrade command signs everyone out; `/api/payload-jobs/run` isn't blocked.

## 2026-11-11 (later): security review of 6ba0366

The security review didn't approve 6ba0366. Each item below has a REST test (`handleEndpoints`) written first. Suite: 37 → 47.

| Promise | Test |
| --- | --- |
| Restoring a collection or global version is refused while masquerading (a global restore skips `beforeChange`, so globals now have a `beforeOperation` guard); the same restores work without a masquerade | `read-only over REST: every other write > refuses restoring collection and global versions…` |
| Unlock, forgot-password and reset-password are refused; the password is unchanged; unlock works without a masquerade | `…refuses unlock, forgot-password and reset-password` |
| Read-only holds for a borrowed token sent as `Authorization: JWT` or `Bearer` | `…Authorization header` |
| No nesting from a borrowed session without the state cookie | `…refuses nesting…` |
| Return ends the borrowed session with the state cookie gone, and restores nothing | `…stop ends the borrowed session…` |
| The README's upgrade step ends a 0.1.0-style borrowed session (no claim) | `…the documented upgrade step…` |
| `canMasquerade` must answer exactly `true`: a truthy value or a throw refuses start, search and restore (403, never 500), marks search results not allowed, and makes the components render nothing | `canMasquerade must answer exactly true > …` (3), `Server Components need an exact true` |

Payload 3.92's write operations that run `beforeOperation` were read from `node_modules/payload/dist`: collections `create`, `update`, `delete`, `restoreVersion`, `unlock`, `forgotPassword`, `resetPassword`; globals `update`, `restoreVersion`. All are refused now. Left allowed on purpose: `login` (it only records the sign-in, and blocking it could lock a masquerader out while a stale cookie lingers) and `refresh` (refused separately for borrowed tokens). Not reachable by any hook: `verifyEmail` (needs the emailed token) and `logout`.

Mutation checks (each fix reverted by a string replace, full suite run, file restored byte for byte), as failing tests: restoreVersion allowed 1; unlock allowed 1; resetPassword allowed 1; no global `beforeOperation` guard 1; stop ignoring the claim 1; `Authorization` header ignored 1; nesting check on the state cookie only 1; `exactlyTrue` accepting truthy values 4; `exactlyTrue` letting throws through 3; start check bypassing the helper 1. forgotPassword allowed survived the REST suite, because Payload's forgot-password also runs an internal `update` that the guard refuses; a hook-level test in `test/config.test.ts` now kills it (1).

0.1.0 borrowed tokens can't be told apart from normal sessions on the server, so the README and CHANGELOG now carry a required upgrade step: clear the sessions of the users who were masqueraded as (the borrowed session lives on the target, not the masquerader). The Local API command is tested; the `mongosh` equivalent is not.

## 2026-11-11: Server Components and real HTTP requests

Closes the two gaps the first audit left for the lead. Suite before: 19 tests. After: 37 (`test/rsc.test.tsx` 10, `test/rest.test.ts` 8).

| Promise | Test |
| --- | --- |
| The banner, account-page button, list cell, nav link and Masquerade view refuse signed-out people, people who may not masquerade, an admin whose permission was removed, and a tampered state cookie, and show no one's name or email when they refuse | `Server Components refuse > …` (7) |
| The banner names the target only while the borrowed session is live and the masquerader may still masquerade as them; otherwise it names nobody and offers the way back | `Server Components refuse > signed-out people holding a leftover state cookie…`, `…permission was removed mid-session…`, `…borrowed session is over, or that someone else is signed in under` |
| An allowed admin gets the button, cell, nav link and search view; no button on their own account; while masquerading a banner naming the target and no way to nest | `Server Components render for an allowed admin > …` (3) |
| Read-only everywhere Payload runs: REST creates, updates, bulk updates, deletes, bulk deletes and global writes refused; reads work; the same requests write when nobody is masquerading | `read-only over REST > …` |
| Same over GraphQL (`@payloadcms/next/routes` `GRAPHQL_POST`, from the dev dependencies): mutations on collections and globals refused, queries answered | `read-only over GraphQL > …` |
| Read-only holds when the browser drops the state cookie | `read-only over REST > stays read-only when the browser drops the state cookie…`, GraphQL test |
| A borrowed session can't be refreshed past its hour; a normal one still refreshes | `read-only over REST > does not let the borrowed session be refreshed past its hour` |
| Return over REST restores the own token, clears the state, and writes work again | `read-only over REST > returns over REST…` |

The harness mocks `next/headers` (the request's cookies), `next/navigation`, the admin's `DefaultTemplate` (a pass-through) and `@payloadcms/ui`'s `Button`. Payload, its auth and MongoDB (in memory) are real; REST goes through `handleEndpoints`, GraphQL through Payload's own route handler. Components are awaited like RSC and rendered with `react-dom/server`. Not seen in a real browser or a real Next.js server.

### Bugs found and fixed

1. **Read-only and the one-hour limit depended on a cookie the browser controls.** Dropping the `payload-masq` cookie (devtools) left a working borrowed session of the target that could create, change and delete as them, with no `masqueraderOf` record. The borrowed session could also be refreshed (`/refresh-token`, which the admin calls while you're active), past its hour. Fix: the borrowed token carries a `masqBy` claim; read-only, the global guard, `assertNotMasquerading`, the start endpoint's no-nesting check and the components treat that claim as masquerading too, and a `beforeOperation` hook on the masquerade collection refuses `refresh` for a borrowed token.
2. **The banner named the target to people it shouldn't.** With only a valid state cookie it showed the target's name and email to anyone at that browser: signed out after the borrowed session ended, signed in as someone else, or a masquerader who had lost permission. Fix: it names the target only when the signed-in user is the target and the masquerader may still masquerade as them; otherwise it says the masquerade has ended (or is no longer allowed), names nobody, and keeps **Return to my account**.
3. Smaller: the list cell, nav link and Masquerade view showed masquerade controls while masquerading as another admin, though starting would be refused (no nesting). They now hide, as the account-page button already did; the view says to return first.

Mutation checks (each fix reverted by a string replace, full suite run, file restored byte for byte): banner ignoring lost permission, 1 failure; banner trusting any signed-in viewer, 1; read-only keyed on the state cookie only, 3; refresh allowed, 1; borrowed token unmarked, 4; account-page button shown while masquerading, 2. The 0.1.0 banner fails 3 of the new component tests; the 0.1.0 read-only fails the dropped-cookie and refresh tests.

### Gaps skipped (and why)

- Rendering inside a real Next.js server or browser: the harness covers the components' own checks; the rest is Next and Payload's rendering.
- The client components' clicks (`fetch` calls to the endpoints): the endpoints themselves are tested over REST.

### Known limits (not bugs, recorded)

- Removing someone's permission doesn't end a borrowed session already running; it ends at its hour, or at return, which then signs them out. The banner stops naming the target straight away.
- Borrowed tokens issued before this fix carry no claim, so for them read-only still rests on the state cookie and refresh isn't refused. Masquerades started after the upgrade are covered; ending running ones at the upgrade clears this.

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
