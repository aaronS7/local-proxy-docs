# Code review and verification

Reviewed on 2026-09-22 against application commit
[`4868827`](https://github.com/aaronS7/local-proxy/tree/4868827fe8a2316a4635bebb802e3b98d549ce29).
This review covers the Go CLI, route merging and discovery, Caddy generation,
editable directory backend, Tailscale link detection, and existing tests.
Application code was not changed by this review.

## Checks performed

| Check | Result |
| --- | --- |
| `go test -race -count=1 ./...` | Passed; package completed in 1.336 seconds |
| `go vet ./...` | Passed |
| Fresh `go build` into a temporary directory | Passed |
| Failed CLI reload with an isolated fake admin endpoint | Registry change persisted; CLI returned an error |
| Project file changed while isolated editor was running | Editor showed new name before generated routes changed |
| `ui --tailnet` with tailnet disabled in registry | Flag accepted but setting remained disabled |
| Editor request with `Host: unknown.example` | Rejected with HTTP 403 |
| Trusted `*.test` certificate, Python/OpenSSL and curl | Both rejected `app.test` with a hostname mismatch |
| Trusted `*.dev.test` certificate, same clients | Both verified `app.dev.test`; curl returned the fixture app response |

The environment was Linux/amd64, Go 1.27.1 and Caddy 2.11.4. The real Caddy
integration test was available because `bin/caddy` existed. A fresh checkout
without that executable skips the integration test, even when a Caddy executable
exists elsewhere on `PATH`.

The additional checks used temporary registries, ports and processes; they did
not rename apps in the running personal registry. The reload failure check used
an HTTP 200 fake admin endpoint and `CADDY_BIN=/usr/bin/false` to make failure
deterministic. These checks are observations from this review, not new automated
regression tests checked into the application suite.

## Findings

### Medium: default `.test` wildcard fails hostname verification in tested OpenSSL clients

[`caddyConfig`, main.go:387](https://github.com/aaronS7/local-proxy/blob/4868827fe8a2316a4635bebb802e3b98d549ce29/main.go#L387)
configures a wildcard certificate for `*.test` under the default suffix. The
existing Go integration test verifies that certificate for `app.test`, but the
tested Python and curl clients reject the wildcard directly below `.test`, even
when they explicitly trust Caddy's generated root CA. Installing the CA does not
fix this hostname-matching difference.

**Observed:** independently launched isolated Caddy instances and then repeated
the check with `scripts/docs-demo.py` using both suffixes. Python using OpenSSL
3.6.4 reported `Hostname mismatch, certificate is not valid for 'app.test'`.
curl 8.22.0 using OpenSSL 3.6.4 returned exit code 60 and
`no alternative certificate subject name matches target hostname 'app.test'`.
Changing only the configured suffix to `dev.test` made Python verification
succeed and curl return the fixture application's JSON. Both clients used the
generated root certificate; no verification bypass was used.

**Documentation consequence:** the default `.test` HTTPS behavior cannot be
described as verified across TLS clients. For the tested curl/Python workflow,
configure `"suffix": "dev.test"` in the registry and register names such as
`app.dev.test`, or run the isolated demo with `--suffix dev.test`. Existing
registrations and fully qualified project-map keys must use the new suffix too.
Configure matching DNS separately; the supplied system installer is fixed to
`.test`. Use `curl --resolve` for a DNS-independent test, with the generated CA
passed through `--cacert`. This finding makes no claim about Chromium's
certificate matching or trust configuration.

**Suggested improvement:** test hostname verification with an OpenSSL client as
well as Go, and choose a default suffix/certificate strategy that satisfies both.

### Medium: CLI failures can leave saved and running routes different

[`saveRoutes`, main.go:401](https://github.com/aaronS7/local-proxy/blob/4868827fe8a2316a4635bebb802e3b98d549ce29/main.go#L401)
writes the registry and generated config before attempting a reload. A failed
reload returns `registry saved, but reload failed` without restoring those
files. The `reload` command uses the same persist-before-apply ordering at
[`main.go:192`](https://github.com/aaronS7/local-proxy/blob/4868827fe8a2316a4635bebb802e3b98d549ce29/main.go#L192).
An unavailable admin endpoint also makes automatic route updates skip reload.

**Observed:** renaming `alpha` to `beta` with the failing Caddy executable returned
exit status 1, while the registry already contained `beta.test`.

**Documentation consequence:** do not describe CLI changes as transactional.
After a failed reload, inspect the saved configuration, correct the reload
failure and run `localproxy reload`. `list` describes the registry and project
defaults, not an independently confirmed view of running Caddy.

**Suggested improvement:** share the editor's apply-and-persist transaction
logic with CLI mutation commands, preserving the ability to update an offline
registry deliberately. Add a regression test for reload failure.

### Medium: the editable directory can display file changes before application

[`uiServer.config`, ui.go:145](https://github.com/aaronS7/local-proxy/blob/4868827fe8a2316a4635bebb802e3b98d549ce29/ui.go#L145)
merges the project map on every directory/API request. Reading the directory
does not reload Caddy. Consequently, editing `proxy.yaml` can change the names
displayed in the UI while requests still use the previously applied routes.
A later successful UI rename applies the complete currently merged route set.

**Observed:** after generating `alpha.test`, changing the map to `gamma: 3000`
made `/api/routes` report `gamma.test`; the generated Caddy route still matched
`alpha.test`.

**Documentation consequence:** explicitly run `localproxy reload` after editing
a project file. A directory entry is a registration, not proof of an applied
route or a healthy upstream.

**Suggested improvement:** distinguish pending project-file changes from the
applied registry in the UI, or render only the applied snapshot until reload.

### Low: `ui --tailnet` is accepted but has no effect

The global parser recognizes and moves `--tailnet`, but dispatches the UI at
[`main.go:79`](https://github.com/aaronS7/local-proxy/blob/4868827fe8a2316a4635bebb802e3b98d549ce29/main.go#L79)
before applying that flag to the configuration at line 102.

**Observed:** an isolated editor started with `ui --tailnet` reported
`tailnet_enabled: false`; the registry stayed disabled.

**Documentation consequence:** enable the persisted option with a generating or
mutating command such as `localproxy reload --tailnet` or
`localproxy generate --tailnet`, then start the editor. With Caddy already
running, use `reload` to apply generated changes.

**Suggested improvement:** honor the flag for the UI explicitly, or reject it
there with an actionable message. Add a flag-dispatch regression test.

## Behavior that documentation must qualify

- **Fallback scope:** static Caddy fallback accepts unknown HTTP hostnames that
  reach its listener. The editable directory also checks the Host header:
  localhost, a single label under the configured suffix, and recognized machine
  Tailscale names/IPs are accepted. Arbitrary external hostnames return 403.
  HTTPS still requires a certificate covering the requested name.
- **Editor recovery:** the editor applies Caddy routes before reporting success
  and attempts to restore Caddy and files if persistence fails. This is
  best-effort recovery, not crash-safe multi-file storage. Rollback can itself
  fail; a failed or timed-out admin request can leave application status
  uncertain. Existing tests cover explicit rejection and a persistence failure,
  not every network or process-crash interruption.
- **Access:** the editor has Host checks, same-origin request requirements,
  CSRF tokens and revision checks. It has no account system; a person able to
  access the directory can obtain its token and edit names. Tailnet sharing
  therefore shares editing access too.
- **Tailnet links:** `--tailnet` only displays detected links. It does not expose
  loopback applications, create Tailscale Serve configuration or verify remote
  reachability through access rules and firewalls. The editor caches detection
  for 15 seconds and refreshes on demand; a static directory refreshes when its
  configuration is regenerated.
- **Discovery:** discovery is explicit, uses IPv4 localhost HTTP HEAD probes and
  keeps registrations when apps stop. It does not discover HTTPS-only or
  IPv6-only upstreams. Eight requests run concurrently; each has a two-second
  timeout.
- **Platform:** `ss`, Unix file locks and the supplied system setup script make
  Linux the verified target. The installer is specifically for Arch/Omarchy
  with systemd-resolved and `.test`. Cross-platform portability was not tested.

## Existing strengths and remaining verification work

The code has small, separate modules for discovery, project-file merging,
Tailnet detection and the UI. It uses strict request parsing, bounded bodies,
atomic replacement of individual files, a shared registry lock and revision
checks for conflicting edits. The HTML template is parsed once; concurrent
render tests check that request-specific values remain isolated.

The existing suite checks real HTTP and certificate-verified HTTPS proxying,
fallback paths, upstream 404 preservation, project-file precedence, invalid
maps, rename conflicts, malformed requests, explicit Caddy rejection,
persistence rollback, listener preservation and race-sensitive behavior.

The next useful tests are the four reproduced findings above, interrupted
reload/persistence recovery, and verification that a configured tailnet listener
is reachable from a second device under its actual access rules. This review
did not change system DNS, install certificate trust, run destructive recovery
tests or measure application proxy throughput. Directory/control-plane benchmark
claims should retain their methodology and must not be presented as end-to-end
proxy speedups.
