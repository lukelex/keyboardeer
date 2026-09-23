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
