# Performance checks

Measured locally on 2026-09-22 with Go 1.27.1, Linux amd64, Intel i9-13900HK,
and `GOMAXPROCS=4`. Values are medians of three 300 ms benchmark runs. All
scenarios use 10 routes unless stated otherwise.

| Operation | Before (µs/op) | After (µs/op) | Speedup | Allocations before → after |
| --- | ---: | ---: | ---: | ---: |
| Render directory | 306.4 | 100.1 | 3.06× | 2,061 → 1,178 |
| Render directory, 100 routes | 1,034.9 | 811.9 | 1.27× | 11,513 → 10,809 |
| Generate static Caddy config | 499.5 | 260.1 | 1.92× | 2,772 → 1,882 |
| Generate editable Caddy config | 361.9 | 59.6 | 6.07× | 2,774 → 811 |
| Directory GET handler | 337.4 | 125.4 | 2.69× | 2,123 → 1,240 |
| Directory HEAD handler | 321.4 | 12.4 | 25.99× | 2,119 → 56 |
| Routes JSON GET handler | 37.6 | 38.2 | Unchanged within observed variation | 422 → 422 |

The embedded HTML template is now parsed once and safely reused with per-request
data. Its output buffer reserves space for the page. HEAD requests still validate
the registry and hostname, but skip rendering and Tailscale queries. Editable
Caddy config generation skips the unused static page and Tailscale queries; the
UI remains responsible for tailnet links.

Memory allocated per directory GET dropped from 293.6 to 216.3 KiB; HEAD dropped
from 252.2 to 8.3 KiB; editable config generation dropped from 286.1 to 48.1 KiB.

These are Go microbenchmarks, not browser page-load or application proxy throughput
measurements. HTTP benchmarks call the handler with a response recorder, include
registry file reads, and use a warm OS file cache. Tailscale is disabled in the
benchmarks to avoid measuring subprocess and network variability. Avoiding those
commands on HEAD and editable config generation is separately regression-tested.
The one-time template parsing cost moves to process startup. Caddy still handles
application traffic; these changes optimize directory and configuration work.

## Reproduce

```sh
GOMAXPROCS=4 go test -run '^$' -bench 'Benchmark(Directory|CaddyConfig)' -benchmem -benchtime=300ms -count=3
go test -race -count=1 ./...
go vet ./...
```

Local raw measurements are in `.local/performance/before.txt` and
`.local/performance/after.txt` (ignored runtime artifacts). Benchmarks live in
`performance_test.go` and use temporary registries without changing real routes.

Regression coverage also checks concurrent renders with different tokens and
URLs, malformed and oversized rename requests, and simultaneous edits using the
same revision. Exactly one edit must succeed, the losing edit must return a
conflict, and Caddy and the registry must agree while custom listeners and the
directory server remain intact.

## Further profiling opportunities

Cold or expired Tailscale lookups still serialize behind the 15-second cache's
mutex. Measure that path with a slow or unavailable daemon before adding
asynchronous refresh, which would introduce stale-data and shutdown behavior.
Large directory rendering still scales with route count. Registry reads remain
uncached so external JSON/YAML changes take effect immediately; benchmark with
large real projects before adding cache invalidation machinery.
