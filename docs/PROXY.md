# Proxy

Vivi can route all of her network traffic — the Claude agent subprocess, voice-model downloads,
Electron's own requests — through an HTTP, HTTPS, or SOCKS5 proxy, configured in **Settings →
Proxy**.

## Modes

- **`none`** (default) — no proxy; Vivi connects directly.
- **`system`** — uses whatever proxy your OS is already configured to use (including a PAC file),
  resolved per-request via Electron's `session.resolveProxy`. This is the right choice if your
  machine already sits behind a corporate or system-wide proxy and you just want Vivi to follow it.
- **`manual`** — you supply the proxy yourself: scheme, host, port, and optional credentials.

## Manual settings

| Field | Meaning |
|---|---|
| `scheme` | `http`, `https`, or `socks5`. |
| `host` / `port` | The proxy's address. |
| `username` | Optional proxy username. |
| (password) | Entered in the same form, but stored separately: the actual password lives in the OS-encrypted secret store, never in the plain settings file — the settings only record whether one is set. |
| `bypass` | A comma-separated list of hosts/patterns to connect to directly instead of through the proxy. Defaults to `localhost,127.0.0.1,<local>`. |
| `caCertPath` | Path to an extra CA certificate to trust, for a proxy that terminates TLS with an internal certificate authority. |

## Where the proxy applies

- **The Claude agent subprocess** gets `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` set from your
  configuration (and `NODE_EXTRA_CA_CERTS` pointing at `caCertPath`, if set) — this is how the
  agent's own API calls and web tools (`WebFetch`/`WebSearch`) go through the proxy.
- **Electron's own network stack** (voice-model downloads, the "Test connection" check) is
  configured directly via `session.setProxy` for `http`/`https`, matching your manual settings or
  the resolved system proxy.
- **A `socks5` proxy, or one with a username/password**, is bridged through a small local HTTP
  proxy Vivi runs on `127.0.0.1` for the duration of the session — Electron's HTTP-only proxy
  configuration and some tooling can't speak SOCKS or authenticate directly, so Vivi does the
  SOCKS handshake and/or credential exchange itself and hands everything else a plain local HTTP
  proxy to talk to.

## Known limitation: custom CA certificates

`caCertPath` is applied to the Claude agent subprocess only, via `NODE_EXTRA_CA_CERTS`. It is
**not** applied to Electron's own network stack — `session.setCertificateVerifyProc` is never
used, so voice-model downloads and the **Test connection** button do not trust a custom CA. If
your proxy does TLS interception with an internal certificate, the agent itself will work fine,
but "Test connection" and model downloads may still fail on a certificate error until your
system's own trust store is updated to include that CA (outside of Vivi's own settings).

## Test connection

**Settings → Proxy** has a "Test connection" button that performs a real request
(`https://api.anthropic.com/v1/models`) through your current proxy configuration and reports
success/failure and latency. A 401 response counts as a successful connection test (it means the
request reached Anthropic's API; you just weren't authenticated for that specific unauthenticated
call) — it's a "connectivity check," not a credentials check.

## Troubleshooting

- **Everything times out** — check `bypass` doesn't inadvertently exclude a host you need, and that
  the proxy's own host/port are reachable from this machine outside Vivi (e.g. with `curl`).
- **Test connection passes but voice-model downloads fail on a certificate error** — see the
  known limitation above; a custom `caCertPath` doesn't cover Electron's own requests.
- **`system` mode doesn't seem to pick up your OS proxy** — confirm the OS-level proxy or PAC file
  is actually active for other apps; Vivi resolves it live per-request rather than caching it once
  at startup, so a proxy that only appears after a network change should still be picked up on the
  next request.
- **SOCKS5 proxy needs a username and password** — this is supported through the local bridge
  described above; if it still fails, check **Settings → Diagnostics** for the bridge's own error
  output.
