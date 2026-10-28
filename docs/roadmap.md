# immich-vdf roadmap: 11 items in 4 releases

## Context

Kevin listed 11 improvements: bugs, speed, UX polish, stack editing, OIDC, security, hardware encoding and a docs redesign. They don't all go into the next release. Decisions:

| Release | Items |
|---|---|
| **0.3.0** | A. JSON error, B. faster actions, C. remember sort, D. static UI first, F. extract/merge survive scans |
| **0.4.0** | E. action animations, G. stack drag, J. docs on Starlight |
| **0.5.0** | H. OIDC (Authelia and Authentik), I. security hardening |
| **0.6.0** | K. hardware encoding (several vendors, only where it helps) |

OIDC sits beside the password, which becomes optional. Hardware encoding is detected automatically across GPU vendors. The docs move to Astro Starlight.

Each release is its own plan, run on its own branch with one commit per topic (CLAUDE.md). Every release ends with the standard checks: `npm test`, `verify-fixture`, `check-cli`, `test:engine`, `lint`, `typecheck`, and a `docker build` smoke test.

---

## Release 0.3.0: fixes, speed, persistence

### A. JSON.parse "unterminated string" (do first)
This has not been reproduced. There are two likely causes, both found by reading the code:
1. **The results response is cut off in transit.** `src/app/api/results/route.ts:16-21` sends about 2.4 MB of gzip with no Content-Length, and Firefox hands the partial text to the page.
2. **The write lock is module-level.** The `chain` in `exclusive()` (`src/lib/json-file.ts:4`) is a module variable. The tsx-loaded copy (scheduler, jobs) and Next's bundled copy each keep their own lock but share one temp path, `${file}.${pid}.tmp`.

Fixes:
- Results route: gzip into a buffer and send `Content-Length`. A short body then fails as a network error instead of arriving as partial JSON.
- `src/components/api.ts:11`: wrap `JSON.parse`. On a SyntaxError, retry once, then show a clear error ("response cut off, N bytes").
- `json-file.ts`: move the lock chain to `globalThis`, as `session.ts:15-25` and `ffmpeg-pool.ts:32` already do. Use a random temp suffix (`crypto.randomUUID()`).
- Test: run concurrent `writeJson` calls from separate module instances and check that the file stays valid.
- Ask Kevin whether a reverse proxy sits in front. If one does, check its buffer and timeout limits.

### B. Faster group actions
Today every action ends with a full GET `/api/results`, and bulk actions send one POST per group in a loop.
- **Patch local state instead of refetching.** Action routes return the changed groups (or the id of a removed one), and `section-screen.tsx` applies them to `results`. The merge override (`setGroupOverride`, `mergeClientGroups`) already shows the pattern. Keep the full reload only for undo (`RESULTS_CHANGED_EVENT`) and as the fallback on failure.
- **Bulk endpoints.** Stack and trash (both sections) accept `groupIds[]` and do one `updateResults` under one lock. Immich calls go through `runPool` (see `immich-stack-sync.ts:38`). This replaces the loops at `section-screen.tsx:710-718` and `733-749`.
- `trashServerItems` (`actions.ts:297`): resolve victim paths in parallel with `runPool`.
- After bulk actions, patch only the results instead of calling `onReload()`, which refetches settings, runtime, runs and trash and resets the draft.
- Measure before and after: stack, trash and ignore on one group, and "stack all" over about 50 groups.

### C. Remember library sorting
- Sort and card size (`src/lib/results-sort.ts:102,106`) move from `sessionStorage` to `localStorage`, per section, with try/catch around each access. Migrate an existing sessionStorage value once.
- Read the value before the first render (a lazy `useState` initializer behind `useClientMounted`), so the default sort doesn't flash. Do the same in `home-screen.tsx:23`.

### D. Static UI first, skeletons only for data
Today the whole rail waits on `draft` (`section-screen.tsx:465`), and the toolbar stays a skeleton while `results` is null (`766-772`).
- **Render immediately:** header, tabs, scan buttons (disabled until runtime arrives), sort, size, filters and the toolbar.
- **Show skeletons only for:** group cards, counts, setting values, run history and Immich status.
- The rail renders its labels right away, with skeletons only for the values.
- Apply the same pattern to `ignored-screen.tsx`, `trash-screen.tsx` and `home-screen.tsx`.

### F. Extracted and merged groups survive scans
Today extract and merge only rewrite `groups` in `data/results/<section>.json`, and `collectResults` (`jobs.ts:581`) overwrites them on the next scan.
- **New side file** `data/group-edits/<section>.json`, modelled on ignore (`store.ts:58`, `ignore.ts`). It holds a list of operations, `{type: "extract" | "merge", members: [key...], createdAt}`, with member keys in the ignore format (paths, or `asset:<id>`).
- **Recording:** `extractResultGroup` and `mergeResultGroups` (`actions.ts:237,250`) append an operation. Undo removes it.
- **Replay:** a new `applyGroupEdits(groups, edits)` in `src/lib/group-edits.ts` runs after parsing in `collectResults` and in `reusedGroups` (`jobs.ts:929-974`), before `saveResults`. It runs before the ignore filter.
  - Extract pulls the surviving members (2 or more) into their own group.
  - Merge unions the groups that hold any listed member.
  - An edit whose members are all gone is pruned.
  - Members are matched loosely, by those that still exist, unlike ignore's exact match.
- **Tests:** a full rescan keeps an extract; a member deleted from disk; a merge target that lands in a different group.

---

## Release 0.4.0: animations, stack drag, docs

### E. Animations confirming trash, stack and ignore
- Use `tw-animate-css`, which is already installed. No new library.
- **Grid:** a card that is trashed, ignored or fully stacked collapses and fades (about 200 ms) before B's local patch removes it. Add the keyframe in `globals.css` beside `skeleton-in`.
- **Viewer:** the button confirms with a check-icon swap and a colour pulse. A newly formed stack pulses its ring on the filmstrip run (`viewer.tsx:713-727`).
- **Toasts:** generalise `undo-toast.tsx` into an action toast ("3 files trashed · Undo"), with an error variant that replaces the `window.alert` calls (`section-screen.tsx:686,722,754`).
- Respect `prefers-reduced-motion`.

### G. Drag thumbnails to change stacks (within a group)
The backend routes already exist: `/stack/join`, `/stack/remove` and `/stack/merge` (`actions.ts:322,357,378`). The work is mostly UI.
- **Where:** the viewer filmstrip (`viewer.tsx:713-756`), which already draws stack runs as ringed blocks. Use native HTML5 drag and drop, the same as `use-group-merge-drag.ts`. Add `@dnd-kit/core` only if touch support is required.
- **Drop targets:**
  - On a stack run: join from loose, or move between stacks. Add a new `/stack/move` route that chains remove and join.
  - On the loose area: remove from the stack.
  - On another loose item: create a new two-item stack (`/api/immich/stack`).
- **Feedback:** valid targets highlight during the drag, and invalid ones show a no-drop cursor. After the drop, B's local patch applies and E's ring pulse plays.
- **Scope and edge cases:** Immich section only. If the cover is moved, refetch that group, because Immich picks a new primary. The existing buttons remain the keyboard path.

### J. Docs on Astro Starlight
- **Site:** a new `docs-site/` (Astro + `@astrojs/starlight`), deployed to GitHub Pages by a workflow. Remove the Jekyll `_config.yml`, `_sass` and `_includes` after the move. Internal docs (`project-context.md`, `immich-vdf-plan.md`, `code.md`) stay in `docs/`, outside the site.
- **Structure:** short pages grouped into sections, instead of a few long ones.
  - **Get started:** overview cards for the Immich and Files sections; install with Docker, Unraid and dev in tabs; first scan.
  - **Guides:** scan settings, reviewing groups, stacks (including drag from G), trash and undo, burst groups, time window, schedules and webhooks, extract and merge.
  - **Concepts (diagrams):** a Mermaid flowchart of the 5-step scan pipeline; skip-unchanged and incremental compare; capture-date priority; the Immich join and path map.
  - **Reference:** env vars table, shortcuts, FAQ and troubleshooting.
  - **Security:** password and reverse proxy now. The OIDC pages are added in 0.5.0.
  - **Development:** build, the engine fork (`FORK.md`), tests, release.
- **Components:** `CardGrid` and `LinkCard` on the landing and section index pages, `Tabs`, `Aside`, `Steps`, and Mermaid through `astro-mermaid`.
- **Theme:** the Immich accent colours from `color_schemes/immich.scss`, a wide content area and a right-hand table of contents.
- **Screenshots:** recapture with playwright-core and Edge (memory: docs-screenshot-capture).
- Point the README links at the new site.

---

## Release 0.5.0: auth and security

### H. OIDC with Authelia and Authentik, password optional
- **Config** (`src/lib/config.ts`, `.env.example`, compose example):
  - Provider: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` (defaults to `<public URL>/api/auth/oidc/callback`).
  - Access: `OIDC_ALLOWED_GROUPS` and/or `OIDC_ALLOWED_USERS` (email or `preferred_username`).
  - Appearance and scopes: `OIDC_LABEL`, `OIDC_SCOPES` (default `openid profile email groups`).
  - `server.ts:24` requires `APP_PASSWORD` only when OIDC is off. `APP_PASSWORD_DISABLED=1` makes login OIDC only.
- **Library:** `openid-client` v6 (discovery, PKCE S256, nonce, `client_secret_basic`). It is the one new runtime dependency.
- **Provider specifics, both must work:**
  - **Authentik:** the issuer is per application (`https://<host>/application/o/<slug>/`, trailing slash included, so keep it as given). Groups come from the `groups` claim in the default profile scope mapping.
  - **Authelia:** the client secret is stored hashed on the Authelia side. Its default `token_endpoint_auth_method` is `client_secret_basic`, and the app sends that. Groups need the `groups` scope, and Authelia's `consent_mode` may show a consent page. Claims may be only in userinfo and not in the id_token (newer Authelia claims policies), so read groups from the id_token and fall back to the userinfo endpoint.
  - Accept `groups` as an array or a string.
- **Routes** (`src/server/raw.ts`):
  - `GET /api/auth/oidc/start`: put state, nonce and the PKCE verifier in a short-lived signed cookie, then redirect.
  - `GET /api/auth/oidc/callback`: exchange the code, validate the id_token, check the allowlist, then issue the session through `issueToken` and `sessionCookie` (`raw.ts:172-173`).
  - Both paths are public (`server.ts:160`). The callback is rate-limited.
- **Session:** the epoch (`session.ts:90`) hashes the password hash and the OIDC config. `TokenBody` gains `sub`. Logout optionally redirects to `end_session_endpoint`, which both providers support.
- **Login form:** a "Sign in with <label>" button. The password field is hidden when the password is disabled.
- **Tests:** `tests/oidc.test.ts` runs against a mock issuer (a local `http.createServer` serving discovery, JWKS, token and userinfo). Cases: happy path, groups only in userinfo, a string `groups` claim, state mismatch, wrong nonce, user not allowed.
- **Manual check:** a `scripts/oidc-dev/` compose file with Authelia and Authentik containers. Log in through each.
- **Docs:** setup pages for Authelia and Authentik, with config snippets for each, in the Starlight Security section.

### I. Security hardening
- Review the 12 Dependabot alerts. Add `.github/dependabot.yml` covering npm, nuget, docker and actions.
- Add a CI workflow on push and PR: tests, lint, typecheck, and `npm audit --omit=dev --audit-level=high`. `docker-publish.yml` waits for it.
- **CSP:** a nonce-based `script-src` without `'unsafe-inline'` (`server.ts:134-158`). Keep `style-src 'unsafe-inline'` for Radix.
- **Cookie:** name it `__Host-vdf_session` when Secure. Add sliding idle expiry under the 12 h cap.
- **Compose example:** `read_only: true`, `tmpfs: /tmp`, and `cap_drop: [ALL]` with only the caps the entrypoint needs (CHOWN, SETUID, SETGID, DAC_OVERRIDE). Verify that native FFmpeg still loads.
- Optionally read the Immich API key from `IMMICH_API_KEY_FILE` (Docker secrets).
- Run `/security-review` on the branch and fix the confirmed findings.
- Add a threat-model page to the docs.

---

## Release 0.6.0: hardware encoding

### K. Hardware encoding across vendors, only where it wins
- **Scope:**
  - The playback transcode (`ffmpeg-args.ts:40-95`, libx264 ultrafast).
  - Optionally the engine's scan decode: `--hardware-accel` exists in `SharedOptions.cs:119`, but the app never passes it.
  - Thumbnails stay software (short MJPEG jobs).
- **Setting:** `Hardware acceleration: auto | off | vaapi | qsv | nvenc`, overridable with `VDF_HWACCEL`.
- **Probe** (`src/lib/hwaccel.ts`):
  - Look for device nodes: `/dev/dri/renderD*` for VAAPI and QSV, the NVIDIA devices or `nvidia-smi` for NVENC.
  - Then run a 1-second `testsrc` encode with each candidate encoder and pick the first that passes.
  - Cache the result. On a runtime failure, fall back to libx264 and retry after 6 h, as `native-ffmpeg.ts` does.
- **Args per backend:** hardware decode, then `scale_vaapi`, `scale_qsv` or `scale_cuda`, then hardware encode. Keep the fMP4 and keyframe flags.
- **Docker:**
  - The image gets `intel-media-va-driver-non-free` and `mesa-va-drivers`.
  - The compose example gets commented `devices: [/dev/dri:/dev/dri]`, `group_add: [render]` and NVIDIA `deploy.resources` blocks.
- **Gate:** benchmark on Kevin's server for 720p time-to-first-frame, CPU load and scan decode throughput against native FFmpeg. Ship only the paths that win. Scan-side hwaccel will likely lose to native FFmpeg, which is already 4–5× faster; if it does, leave it off.

---

## Dependencies
- 0.3.0: A first. B, C, D and F are independent of each other.
- 0.4.0: E builds on B's local patching. G builds on B and E. J documents F and G.
- 0.5.0: H adds its pages to J's site. I's CI workflow helps every later release.
- K's benchmark can run any time, if an early answer on whether it's worth it is useful.

## Verification (per release)
- The standard checks are green, plus the new tests named under each item.
- Preview at `npm run dev`, port 4747. Check the port is free first.
  - **0.3.0:**
    - The large results set loads with no parse error.
    - After an action, the network tab shows no `/api/results` GET.
    - The sort survives a browser restart.
    - The toolbar paints before the data arrives.
    - Extract a group, rescan, and the group stays split.
  - **0.4.0:**
    - Animations and toasts appear for each action, and reduced motion is respected.
    - Dragging a filmstrip item into, out of and between stacks shows up in Immich.
    - `astro build` passes with no broken links.
  - **0.5.0:**
    - Login works through Authelia, through Authentik, and with the password.
    - The console shows no CSP violations.
  - **0.6.0:** the hwaccel probe result and benchmark numbers are recorded in the PR.
