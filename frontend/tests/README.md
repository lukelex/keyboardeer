# Frontend regression checks

From `frontend/`:

```sh
npm ci
npx playwright install chromium
npm test
```

Tests start their own Vite server on `127.0.0.1:5186` and inject explicit Wails
fixtures. They never contact the user's manager or modify saved profiles.

`workspace.spec.ts` covers the real JSON shape that previously crashed the
Devices view: Go nil slices encode as `null`, not `[]`. It also checks the
first edit of a new profile with null assignments and workspace event updates.

`ux.spec.ts` checks layout and interaction at real desktop window sizes against
`fixtures/us-ansi-tkl.json`, a copy of the verified `us-ansi-tkl-v1` template
from `internal/geometry`. Refresh the copy if that template changes.
