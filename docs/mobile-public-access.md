# Public Access for Phone-Paired Sessions (π.ink with LAN-First Routing)

This document covers how to extend Pi Desktop's phone remote view (`/m`) from "works only on the same Wi-Fi" to "works on any network", plus a step-by-step runbook for exposing it through Cloudflare Tunnel on a self-hosted domain (`π.ink`).

- Audience: whoever maintains Pi Desktop on this machine. Commands assume macOS.
- Last updated: 2026-09-20.

---

## 1. Goals and Non-Goals

**Goals**

1. A phone on any network (home Wi-Fi, corporate network, cellular) can scan a code, open `/m`, read the session, send prompts, watch streaming output, and answer `ask_user` prompts.
2. When the phone is on the same network as the desktop, route over **the LAN directly**: lower latency, data never leaves the local network, no tunnel bandwidth consumed.
3. When it is not, route over **the public entry `https://π.ink`** (Cloudflare Tunnel back to this machine).
4. Authentication, rate limiting and logging stay a **single implementation**: the existing Rust ingress proxy (`src-tauri/src/lan_proxy.rs`). LAN and public traffic hit the same process, the same config, the same log file.

**Non-goals**

- Multi-user, accounts, or exposing the agent to third parties.
- A native phone app.

---

## 2. What Already Exists, and the Two Hard Constraints

| Existing capability | Location | Role in public access |
| --- | --- | --- |
| Single ingress proxy (binds `0.0.0.0` on a random port, HTTP Basic, hot-reloaded password) | `src-tauri/src/lan_proxy.rs` | The tunnel's origin points here, so auth/rate limiting/logging stay in one place |
| `Host` / `Origin` rewritten to loopback, `Connection: close` forced | `lan_proxy.rs::rewrite_request_head()` | Next still sees loopback requests, so `proxy.ts` host/origin checks and `PI_WEB_DESKTOP_API_ORIGIN` need no change |
| Credential-free asset allow-list (`/manifest.webmanifest`, `/sw.js`, `/icons/*`, ...) | `lan_proxy.rs::is_public_asset_request()` | Already the seed of a path allow-list; the public allow-list follows the same pattern |
| Failed-auth counter with exponential backoff | `lan_proxy.rs::backoff_after_failure()` | Foundation for public rate limiting |
| SSE stream with a 30s heartbeat | `lib/agent-event-stream.ts` (`HEARTBEAT_INTERVAL_MS`) | Enough to keep Cloudflare's idle timeout fed; no tunnel-side change needed |
| Pure, unit-tested pair-info logic | `lib/mobile-pair.ts` / `lib/mobile-pair.test.mjs` | Route decision logic goes here too (pure and testable) |
| Runtime state writeback (`lanPort`, counters, `lastPeer`) | `~/.pi/agent/desktop-access.runtime.json` | Extend with `publicIp` / `tunnelUrl` |
| Phone page and projection | `app/m/page.tsx`, `components/MobileRemoteView.tsx`, `lib/mobile-state.ts` | No public-access changes needed; it calls the API with relative URLs |

**Two hard constraints**

1. **The tunnel origin must be `127.0.0.1:<lanPort>` (the Rust proxy), never Next's own port.** Otherwise traffic bypasses the single gate: Next's "non-loopback requires a password" check becomes meaningless and nothing is logged.
2. **`lanPort` can change on every launch.** The proxy binds port 0 (an OS-assigned free port) and writes the real port to `~/.pi/agent/desktop-access.runtime.json`. Tunnel config therefore cannot hardcode it forever: during the manual phase you re-check after each app restart; in the automated phase (P1) the desktop app generates the config before starting the tunnel.

---

## 3. Target Architecture

```
                                    ┌──── same network: direct (preferred) ────┐
                                    │                                          ▼
Phone Safari / PWA ─────────────────┤                        http://<lan-ip>:<lanPort>
                                    │                        (Rust ingress proxy)
                                    └─ https://π.ink ──TLS──▶ cloudflared ──▶ 127.0.0.1:<lanPort>
                                            (Cloudflare edge)                (same Rust ingress proxy)
                                                                                       │
                                        single gate: HTTP Basic, rate limiting, real IP, path allow-list, logs
                                                                                       ▼
                                                                    127.0.0.1:<next-port>
                                                                    /m, /api/mobile/*, /api/agent/*
```

Both paths end at the **same proxy process**. That is the foundation of the whole design: the security policy exists once, and there is no "the public route skipped a check" possibility.

---

## 4. LAN vs Public: Decision and Handoff

### 4.1 Why the client cannot probe for the LAN first

This is the easiest trap in the design, so it comes first:

- The public entry is **HTTPS**; the LAN address is **HTTP** (`http://192.168.x.x:<lanPort>`).
- Any **subresource request** (`fetch` / `XMLHttpRequest` / `<img>` / `<iframe>` / `<script>`) issued by an HTTPS page toward `http://` is blocked by the browser as **mixed content** — the request never leaves. Chrome/Edge additionally apply a Private Network Access preflight on top of "public page → private address" (the response needs `Access-Control-Allow-Private-Network: true`), and Safari on iOS 18+ asks for separate local-network permission.
- **Top-level navigation is the exception**: `location.href = "http://192.168.1.5:8080/m"` from an HTTPS page is allowed (the browser warns that the connection is not secure).

The reverse also fails: pointing the QR code at the LAN address and falling back to the public URL does not work, because when the phone cannot reach that address the browser shows its own error page and no page JS ever runs.

Conclusion: **the decision must happen server-side; the client only performs one top-level navigation.**

### 4.2 Server-side decision

Two inputs:

| Input | Source |
| --- | --- |
| **Phone egress IP** (`clientIp`) | `CF-Connecting-IP` (Cloudflare Tunnel always sets it) → else the first entry of `X-Forwarded-For` → else the TCP peer address. **The source must be a trusted ingress** (requests reaching the local proxy come from cloudflared over loopback) |
| **Desktop egress IP** (`desktopIp`) | The desktop polls `ip=` from `https://cloudflare.com/cdn-cgi/trace` every 5 minutes, once for IPv4 and once for IPv6, cached in memory and written back to `desktop-access.runtime.json` |

Decision rules (`ipMatchMode`, default `subnet`):

| Case | Decision |
| --- | --- |
| Both IPv4 and the **first 24 bits match** (same `/24`) | Same network → **LAN** |
| Both IPv6 and the **first 64 bits match** (same `/64`) | Same network → **LAN** |
| `clientIp` is itself a private/loopback address (the request came from inside the LAN) | Same network → **LAN** |
| One side is IPv4-only and the other IPv6-only (dual-stack mismatch) | Undecidable → **public** |
| Anything else | **public** |

Additional rules:

- Cache the decision per `clientIp` for 5 minutes instead of recomputing per request.
- The default direction when undecidable is **public** — it always works, which is the cheapest failure mode.
- If you prefer zero false positives, set `ipMatchMode` to `exact`: only identical egress IPs (IPv6 still compared by `/64`) count as the same network.
- The cost of `subnet`: different subscribers behind the same carrier CGNAT pool often land in the same `/24`. Those get classified as "same network", the phone jumps to a private address, and the page fails to load. Mitigations are in 4.3.

### 4.3 Handoff and fallback

1. The phone opens `https://π.ink/m?session=<id>&cwd=<path>`.
2. When the decision is "same network", **do not use an HTTP 302**. Return a 200 decision page that navigates with JS:
   ```js
   location.replace(lanUrl);   // the page also says: "no response within 3s? press Back and open the public URL"
   ```
   A 302 would be removed from session history, leaving the user no way back after a false positive; with a 200 + JS navigation, **the browser Back button returns to the HTTPS decision page**.
3. The LAN page (HTTP) carries an "open over the internet" button pointing back at `https://π.ink/m?...`. `http → https` is never restricted, so this path always works.
4. False-positive memory: when the LAN page loads, it beacons the public side (an `<img>` hit on the public entry) saying "I am alive". A device that fails the LAN jump twice in a row goes straight to the public entry afterwards (stored in each origin's own `localStorage`).
5. **The two origins share no state**: `https://π.ink` and `http://192.168.x.x:<lanPort>` are different origins, so `localStorage` / `sessionStorage` / HTTP Basic credentials are not shared. After switching, the phone authenticates again on the new origin. That is a browser rule, not an implementation gap.
6. LAN mode is plain HTTP: **not a secure context**, so no Service Worker and no installable PWA. The installable/offline experience only exists on the `https://π.ink` side.

---

## 5. Security Boundary

The conclusion of this section: **keeping the current authentication model (scan the code + password + unguessable `sessionId`/`cwd`) is acceptable, but the items below must land before public access is enabled.**

### 5.1 Kept as-is

- HTTP Basic auth, fixed username `pi`, password configured in Settings → Phone access (minimum 8 characters).
- The password lives in `~/.pi/agent/desktop-access.json` (mode 600). The proxy re-reads the file every 400ms, so changing the password **requires no restart**.
- Without a password the proxy refuses to enable itself; a corrupt config always falls back to disabled.
- The credential-free allow-list only covers PWA assets (`/manifest.webmanifest`, `/sw.js`, `/offline.html`, `/icons/*`), and only GET/HEAD.

### 5.2 Required before exposing publicly

1. **Expose 443 only.** Enable Always Use HTTPS at the Cloudflare edge; the tunnel origin listens on loopback only; never add a router port-forward.
2. **A public path allow-list (highest value, lowest cost).** The public entry allows only what the phone actually needs; everything else is 403:

   | Allowed publicly | Blocked publicly |
   | --- | --- |
   | `/m`, `/_next/static/*`, `/sw.js`, `/offline.html`, `/manifest.webmanifest`, `/icons/*` | `/api/files/*`, `/api/sessions*`, `/api/sessions/*/export` |
   | `/api/mobile/state`, `/api/mobile/pair`, `/api/agent/[id]` (prompt / abort / extension_ui_response) | `/api/models*`, `/api/models-config/*`, `/api/auth/*` |
   | `/api/agent/[id]/events` (SSE), `/api/agent/new` | `/api/skills/*`, `/api/plugins/*`, `/api/worktrees/*`, `/api/cwd/*`, `/api/default-cwd` |

   Plus **pairing scope binding**: the public entry may only touch the session (and its `cwd`) it was paired with, and `/api/agent/new` is locked to that directory.
3. **The real client IP must be written by the proxy, and incoming headers of the same name must not be trusted.** The proxy deletes every inbound `CF-Connecting-IP` / `X-Forwarded-For` / `X-Pi-*` and then sets its own value. Otherwise anyone can forge `X-Forwarded-For: <your public IP>` and win the "same network" decision.
4. **Add a per-IP rate limit.** `recordFailedWebAuthAttempt` is process-wide (20 per 60s); add "5 per minute per source IP, 10 minute ban" on top for the public listener.
5. **Automatic shutoff.** Public access is off by default; when enabled it supports `autoOffHours` (12 hours suggested), the settings page shows the remaining time, and the main window shows a persistent banner with a one-click disconnect.
6. **Real logging.** The `peer` recorded in `~/.pi/agent/desktop-access.log` must become the real client IP — over a tunnel, peer is always `127.0.0.1`, which identifies nobody.
7. **Password hygiene.** Do not reuse it anywhere else; browsers remember Basic credentials, so after rotating the password, clear the site data on the phone; the only revocation mechanism for a lost phone is changing the password.

### 5.3 Accepted trade-offs (written down for later review)

**No device tokens**, justified as "the link can only be obtained by scanning the code, and `sessionId` + `cwd` cannot be guessed". That holds **as long as the link does not leak**, but it also means:

- A leaked Basic password (borrowed phone, browser sync, a screenshot, password reuse) equals arbitrary command execution on this machine.
- No fine-grained revocation: you can change the password, not kick a single phone.
- The allow-list is the only mechanism limiting "what can be done after a leak", so item 2 in 5.2 is worth keeping.

**Reconsider device tokens** if any of these becomes true: public access needs to stay on permanently / several devices share one password / that password has been used elsewhere / the phone may be used by someone else.

---

## 6. Code Touchpoints (P1 and later)

**Node side**

- `lib/mobile-pair.ts`: add `publicUrl` / `lanUrl` / `route` to `MobilePairInfo`; add a pure `resolveMobileRoute({ clientIp, desktopIp, ipMatchMode })` → `"lan" | "public"` with tests in `lib/mobile-pair.test.mjs`.
- New `lib/desktop-public-ip.ts`: egress IP lookup with a 5 minute cache (memory + writeback to `desktop-access.runtime.json`).
- New `app/api/mobile/entry/route.ts`: decision + decision page (200 + JS navigation), or `?decision=json` for page use.
- `app/api/mobile/pair/route.ts`: return both addresses (LAN + public) and the suggested route.
- `lib/desktop-access.ts`: extend `desktop-access.json` to `{ enabled, password, public: { enabled, hostname, ipMatchMode, autoOffAt }, devices: [] }`; **a corrupt config always falls back to "everything off"** (keep the current principle).

**Rust side**

- `lan_proxy.rs`: add pure `real_client_ip(head)` (trusted headers only, strip before setting) and `is_public_path_allowed(path)`, both covered by `cargo test --lib lan_proxy`; add `publicIp` / `tunnelUrl` to `desktop-access.runtime.json`.
- New `src-tauri/src/tunnel.rs` (or fold into the existing manager thread): manage the cloudflared child process — generate config from the live `lanPort`, start, health check, write the public URL back to the runtime file, clean up on app exit.
- `src-tauri/src/lib.rs`: `start_lan_proxy()` becomes `start_mobile_access()` (proxy + tunnel together); `stop_server()` stops both.

**Frontend / i18n**

- `components/MobileAccessSettings.tsx`: a new "Public access" section (switch, hostname, match mode, auto-off countdown, persistent banner while public access is live).
- `components/MobilePairDialog.tsx`: mode toggle (auto / LAN only / public only), both addresses, copy button.
- `lib/i18n/messages/*`: add the new keys to every language package (currently en and zh-CN).
- Tests: `lib/mobile-pair.test.mjs`, `components/MobileRemoteView.test.mjs` (keep `/m` free of desktop renderers).

---

## 7. Phases

| Phase | Contents | Code changes |
| --- | --- | --- |
| **P0** | Point Cloudflare Tunnel at `127.0.0.1:<lanPort>` and hand-build `https://π.ink/m?session=&cwd=` (section 8 below) | None |
| **P1** | Pair dialog publishes the public address; server-side same-network decision; navigation fallback | Required |
| **P2** | Public path allow-list, per-IP rate limit, auto shutoff, persistent banner, real-IP logging | Required |
| **P3** (optional) | HTTPS on the LAN too (`*.lan.pi.ink` wildcard cert + private A records), true client-side reachability probe, 100% accurate routing, installable PWA on the LAN | Required |

**P0 with zero code changes is real**: the existing proxy already handles auth, Host/Origin rewriting and byte-exact SSE forwarding, and the phone page only uses relative API URLs. Pointing a tunnel at the proxy port is enough to use it. The only rough edge is that the URL must be assembled by hand.

---

## 8. Runbook: Cloudflare Tunnel + π.ink

### 8.0 Preconditions

1. `π.ink` is already hosted on Cloudflare: the zone is visible in the dashboard and shown as Active (nameservers point at Cloudflare). If `π.ink` is an IDN, Cloudflare stores punycode internally; if a CLI tool rejects the domain, get the punycode form with:
   ```bash
   node -e "console.log(new URL('https://π.ink').hostname)"
   ```
2. LAN access already works:
   - Settings → Phone access: enable it and set a password of at least 8 characters.
   - Join the phone to the **same Wi-Fi**, open the QR code from the app, and confirm you can read the session and send a prompt.
   - Do not touch DNS before this works, or you will debug two problems at once.
3. Note the current ingress port (**it can change on every restart**):
   ```bash
   cat ~/.pi/agent/desktop-access.runtime.json
   # {"lanPort":53124,"listening":true,"authSuccesses":0,...}
   ```
4. Confirm the app is running and the phone-access switch is on. With the switch off the proxy does not listen at all and the tunnel returns 502.

### 8.1 Install cloudflared

```bash
brew install cloudflared
cloudflared --version
```

### 8.2 Authorize (once)

```bash
cloudflared tunnel login
```

A browser opens; select the `π.ink` zone and authorize. The certificate lands at `~/.cloudflared/cert.pem`.

### 8.3 Validate the path with a temporary tunnel (no DNS involved, disposable)

```bash
PORT=$(node -e "console.log(require(process.env.HOME + '/.pi/agent/desktop-access.runtime.json').lanPort)")
cloudflared tunnel --url http://127.0.0.1:$PORT
```

It prints a `https://xxxx-xxxx.trycloudflare.com` URL. Switch the phone to **cellular only** (that is the point — validating the public path) and open:

```
https://xxxx-xxxx.trycloudflare.com/m?session=<session id>&cwd=<session cwd>
```

Expected: a Basic auth prompt → enter `pi` and the password → the remote view opens, prompts work, streaming output appears.

**If this passes**, auth, Host/Origin rewriting, SSE forwarding and the Cloudflare-to-local path are all fine and you can bind the domain. **If it fails**, see 8.9; do not continue.

To find the session id: open that session on the desktop — the `session=` parameter in its URL is the id. `cwd` is the session's working directory (readable from the project path in the sidebar; remember URL encoding).

### 8.4 Create the named tunnel and bind π.ink

```bash
cloudflared tunnel create pi-desktop
# the output prints a UUID; the credentials file is ~/.cloudflared/<UUID>.json

cloudflared tunnel route dns pi-desktop π.ink
cloudflared tunnel list
```

`route dns` creates a CNAME for `π.ink` pointing at `<UUID>.cfargotunnel.com`.

### 8.5 Write the config

`~/.cloudflared/config.yml`:

```yaml
tunnel: <UUID>
credentials-file: /Users/<you>/.cloudflared/<UUID>.json

ingress:
  - hostname: π.ink
    service: http://127.0.0.1:<lanPort>
    originRequest:
      # make Next see a loopback host (the proxy rewrites Host too; this is belt and braces)
      httpHostHeader: 127.0.0.1:<lanPort>
      # must stay false: when enabled, responses are no longer chunked and SSE stalls
      disableChunkedEncoding: false
      connectTimeout: 30s
  - service: http_status:404
```

Replace `<lanPort>` with the port from step 3 of 8.0. **The port can change when Pi Desktop restarts** — re-check and edit (P1 removes this manual step by generating the file).

### 8.6 Start and verify

```bash
cloudflared tunnel run pi-desktop
```

Keep it in the foreground and watch the logs. In another terminal (if the shell cannot resolve the IDN domain, substitute the punycode form from 8.0):

```bash
HOST=$(node -e "console.log(new URL('https://π.ink').hostname)")

# 1) no credentials: expect 401
curl -s -o /dev/null -w '%{http_code}\n' "https://$HOST/m"

# 2) with credentials: expect 200
curl -s -o /dev/null -w '%{http_code}\n' -u 'pi:YOUR_PASSWORD' "https://$HOST/m"

# 3) phone API: expect JSON (note the session parameter)
curl -s -u 'pi:YOUR_PASSWORD' "https://$HOST/api/mobile/state?limit=5" | head -c 200
```

When all three are right, check the local log:

```bash
tail -n 20 ~/.pi/agent/desktop-access.log
# expect lines like: auth OK peer=127.0.0.1 ... forwarded
```

Finally verify on the phone: **turn Wi-Fi off, use cellular**, open `https://π.ink/m?session=<id>&cwd=<path>`, send a prompt and confirm the answer streams in character by character (only this proves SSE is not buffered through Cloudflare).

### 8.7 Cloudflare settings

| Location | Setting | Why |
| --- | --- | --- |
| SSL/TLS → Edge Certificates | **Always Use HTTPS: On** | avoid plaintext `http://π.ink` |
| Speed → Optimization | **Rocket Loader: Off** | it rewrites page JS and helps no Next app |
| Caching → Cache Rules | new rule: `URI Path` starts with `/api/` → **Bypass cache**; also bypass `/m` | APIs and the remote view must never be cached |
| Security → Settings | **do not enable Under Attack Mode / Bot Fight Mode** | they inject JS challenges into the phone page and can block POST APIs |
| Network | WebSockets stays on (default) | not needed in production, but leave the default |

With a tunnel there is no need to change the SSL/TLS encryption mode: Cloudflare and cloudflared talk over an encrypted tunnel connection, and cloudflared reaches this machine over plaintext loopback.

### 8.8 Keeping it running (optional; P1 should own this)

Temporarily in the background:

```bash
nohup cloudflared tunnel run pi-desktop > /tmp/cloudflared.log 2>&1 &
```

For long-lived operation use launchd with `KeepAlive`. The better option is to wait for P1 and let Pi Desktop start the tunnel itself, so **quitting the app takes the public entry down** and you never end up with a forgotten, permanently exposed machine.

### 8.9 Troubleshooting

| Symptom | What to check |
| --- | --- |
| Phone shows a blank page / spins forever | Is there an `auth OK peer=127.0.0.1` line in `~/.pi/agent/desktop-access.log`? If not, the tunnel is not reaching the proxy: compare the port in `config.yml` with `desktop-access.runtime.json`, confirm Pi Desktop is running, and confirm the phone-access switch is on (with it off the proxy does not listen and the tunnel returns 502) |
| Repeated auth prompts / always 401 | wrong password, or the phone cached old credentials (Safari → clear the site data for that origin and retry) |
| 429 responses | the failed-auth rate limit. Wait 60 seconds; if it keeps happening someone is guessing passwords — turn public access off and rotate the password |
| Page opens, but sending a prompt does nothing | SSE is being buffered: confirm `disableChunkedEncoding: false` in `config.yml`, confirm the response carries `Cache-Control: no-transform` (already in the code), and confirm no Cache Rule caches `/api/` |
| `curl` works but the phone does not | phone-side DNS or cellular issue; open `https://π.ink` directly on the phone, and try both cellular and Wi-Fi |
| Everything 502s after an app restart | `lanPort` changed; update `config.yml` and restart cloudflared |
| The LAN jump lands on an unreachable page | same-network false positive (typically the same carrier CGNAT `/24`): press Back to return to the HTTPS page and use "open over the internet"; long term, switch `ipMatchMode` to `exact` |

### 8.10 Shutting down and rotating

```bash
# disconnect: stop the tunnel process (Ctrl+C in the foreground, pkill -f 'cloudflared tunnel run' in the background)
# revoke entirely: delete the tunnel, then the DNS record
cloudflared tunnel delete pi-desktop
# also delete the CNAME on π.ink in the Cloudflare dashboard
```

Rotating the password: Settings → Phone access → change it (takes effect immediately, no process restarts), then clear the site data on the phone and authenticate again.

### 8.11 Alternative: your own VPS with frp

If you would rather not depend on Cloudflare: point the `π.ink` A record at your own VPS, run `frps` there (with a TLS certificate) and `frpc` locally, exposing `127.0.0.1:<lanPort>` on the VPS's 443. The essentials are identical — **the origin must still be that ingress proxy port** — but you own certificate renewal, VPS hardening and the frps-side access logs. Clearly more work than Cloudflare Tunnel; choose it only if full self-hosting is a requirement.

---

## 9. Follow-ups

- [ ] P1: add `resolveMobileRoute()` and tests to `lib/mobile-pair.ts`.
- [ ] P1: `app/api/mobile/entry/route.ts` decision page (200 + JS navigation that stays in history).
- [ ] P1: `MobilePairDialog` publishes the public address and a mode toggle.
- [ ] P2: `real_client_ip()` and `is_public_path_allowed()` in `lan_proxy.rs`, with Rust tests.
- [ ] P2: a `public` section in `desktop-access.json`, auto shutoff, real-IP logging.
- [ ] P2: `src-tauri/src/tunnel.rs` manages cloudflared for the app's lifetime and generates config from the live `lanPort`.
- [ ] P3 (optional): HTTPS on the LAN with a wildcard certificate and a true client-side probe.
