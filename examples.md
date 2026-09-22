# Working examples

The disposable demo launches two HTTP fixture apps, Caddy, and the editable
directory. It uses available high ports on loopback and a temporary registry.
It does not modify your existing routes, DNS configuration, certificate trust,
Tailscale settings, or running proxy services.

## Launch the demo

Build `bin/localproxy` and provide a Caddy executable at `bin/caddy` or on `PATH`:

```sh
go build -o bin/localproxy .
python3 scripts/docs-demo.py --suffix dev.test --state-file .local/docs-demo-state.json
```

The command stays in the foreground until you press **Ctrl-C**. It prints a JSON
object after the services are ready. Open its `directory_url` in your browser.
You can search, edit names, review the confirmation, save, and undo changes.
The fixture apps return JSON describing the app name, original host, and path.

Ports vary each run. This is intentional: the example can run alongside your
normal development environment. The `.dev.test` links still require local DNS and
certificate trust for browser navigation; the directory's HTTP loopback URL and
original localhost links work without that setup. The commands below bypass DNS
only for their individual HTTP requests.

In a second terminal, from the repository root:

```sh
DEMO_STATE="$PWD/.local/docs-demo-state.json"
DEMO_HTTP=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ports"]["http"])' "$DEMO_STATE")
DEMO_REGISTRY=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["registry"])' "$DEMO_STATE")
DEMO_CLI="$PWD/bin/localproxy"

curl --noproxy '*' -H 'Host: app.dev.test' "http://127.0.0.1:$DEMO_HTTP/hello?source=docs"
curl --noproxy '*' -H 'Host: api.dev.test' "http://127.0.0.1:$DEMO_HTTP/"
```

The first response identifies `app` and preserves `/hello?source=docs`; the
second identifies `api`.

## Verify HTTPS without installing a CA

This demo uses `.dev.test` so its wildcard certificate is accepted by OpenSSL
clients. Read the generated CA path and HTTPS port, then make a request with
normal certificate-chain and hostname verification:

```sh
DEMO_HTTPS=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ports"]["https"])' "$DEMO_STATE")
DEMO_CA=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ca_file"])' "$DEMO_STATE")
curl --noproxy '*' --cacert "$DEMO_CA" \
  --resolve "app.dev.test:$DEMO_HTTPS:127.0.0.1" \
  "https://app.dev.test:$DEMO_HTTPS/"
```

**Known limitation:** the project's default `.test` suffix produces a `*.test`
certificate. Go's verifier accepts it, but the OpenSSL-backed Python and curl
clients tested here reject a wildcard immediately beneath the top-level domain
with a hostname-mismatch error. Trusting the CA alone does not fix that mismatch.
The demo's `--suffix dev.test` uses `*.dev.test` and passes those clients without
disabling certificate checks. Screenshots use the default `.test` suffix over
HTTP. The regular CLI configures its suffix through the registry's `suffix`
field; its system DNS installer remains specific to `.test`.

## Check fallback and upstream errors

```sh
# An unregistered .dev.test name displays the directory, including localhost ports.
curl --noproxy '*' -H 'Host: missing.dev.test' "http://127.0.0.1:$DEMO_HTTP/deep/path"

# The registered app's own 404 is preserved.
curl --noproxy '*' -i -H 'Host: app.dev.test' "http://127.0.0.1:$DEMO_HTTP/missing"
```

The editable directory restricts its accepted Host headers. A completely
unrelated hostname can receive `403`; unregistered names in the configured
suffix work. DNS must still direct browser requests to Caddy for fallback to run.

## Override a project name

Run commands from the demo directory so project-file discovery selects its map:

```sh
(
  cd "$(dirname "$DEMO_REGISTRY")"
  "$DEMO_CLI" -config "$DEMO_REGISTRY" list
  "$DEMO_CLI" -config "$DEMO_REGISTRY" rename app studio
  "$DEMO_CLI" -config "$DEMO_REGISTRY" reload
)
curl --noproxy '*' -H 'Host: studio.dev.test' "http://127.0.0.1:$DEMO_HTTP/"
```

`studio.dev.test` still returns the `app` fixture after reload. The override is saved
in the registry; the generated `proxy.yaml` remains unchanged. Refresh the
directory to see the new name. You can rename `studio` back to `app` with the same
command or in the editor.

## Use your own project map

[proxy.yaml](examples/proxy.yaml) and [proxy.json](examples/proxy.json) contain
equivalent mappings:

```yaml
app: 3000
api: 8080
```

These example files describe your own apps at ports 3000 and 8080. They do not
launch those apps. Use one format in your project directory, or choose explicitly
with `-file` if both exist:

```sh
EXAMPLE_DIR=$(mktemp -d)
./bin/localproxy -config "$EXAMPLE_DIR/routes.json" \
  -file "$PWD/docs/examples/proxy.json" generate
```

That command writes a separate registry and Caddy configuration under
`$EXAMPLE_DIR`; it does not start Caddy or change your current instance. Use
`-config /path/to/routes.json` before the command to select an existing instance.
The demo generates an equivalent map with its actual available ports.

## Reproduce the checks

```sh
python3 scripts/verify-docs-example.py --output .local/docs-evidence/examples.json
```

The verifier starts its own fresh `.dev.test` demo, verifies HTTPS with its local
CA and hostname, exercises routing, directory fallback,
project file selection, CLI rename and reload, editor rename and stale-revision
rejection, and teardown. It exits nonzero on a failed check and writes JSON
evidence on success. The report describes this isolated fixture run; it does not
establish that DNS, certificate trust, or tailnet access are configured on your
machine.

Stop your interactive demo with **Ctrl-C** when finished. Its child processes,
temporary registry, local CA, and state file are removed.
