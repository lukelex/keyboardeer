import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type {
  GeometryTemplate,
  ManagerWorkspace,
  Profile,
} from "../src/desktop";

// A copy of the verified US ANSI TKL template from internal/geometry, so the
// layout checks below run against a full-size, six-row physical keyboard.
const tkl = JSON.parse(
  readFileSync(new URL("./fixtures/us-ansi-tkl.json", import.meta.url), "utf8"),
) as GeometryTemplate;

const available = (name: string) => ({
  name,
  available: true,
  reason_code: "capability_available",
  reason: "Available",
});

const workspace: ManagerWorkspace = {
  status: {
    state: "ready",
    message: "Manager capabilities are available.",
    endpoint: "/run/user/1000/kmonad-device-manager/api.sock",
    server_id: "server-1",
    capabilities: [
      "device_discovery",
      "device_identification",
      "candidate_validation",
      "managed_configurations",
      "configuration_export",
    ].map(available),
  },
  snapshot: {
    state_revision: 1,
    event_cursor: { server_id: "server-1", event_id: 0, state_revision: 1 },
    devices: [
      {
        id: "device-1",
        display_name: "Keychron K8 Pro",
        role: "input",
        availability: "connected",
        identity_stability: "serial",
        configured_by: ["cfg-1"],
        runtime_conflict: false,
        reason_code: "device_connected",
        reason: "Connected over USB",
      },
    ],
    configurations: [
      {
        id: "cfg-1",
        name: "Home row mods",
        ownership: "managed",
        enabled: true,
        device_id: "device-1",
        desired_revision: 7,
        active_revision: 7,
        runtime: {
          phase: "running",
          reason_code: "runtime_running",
          reason: "KMonad process running",
          connected: true,
          healthy: true,
          failure_count: 0,
        },
      },
    ],
    operations: null,
    health: {
      healthy: true,
      reason_code: "manager_healthy",
      reason: "Healthy",
    },
  },
};

const profile: Profile = {
  id: "profile-1",
  name: "Home row mods",
  device_id: "device-1",
  draft_revision: 3,
  manager_configuration_id: "cfg-1",
  geometry: { id: tkl.id, source_keys: tkl.keys.map((key) => key.source_key) },
  layers: [
    { id: "base", name: "Base" },
    { id: "layer-nav", name: "Navigation" },
  ],
  assignments: [
    {
      layer_id: "base",
      source_key: "caps",
      behavior: {
        kind: "tap_hold",
        tap: { kind: "key", key: "esc" },
        hold: { kind: "key", key: "lctl" },
        timeout_ms: 200,
      },
    },
    {
      layer_id: "base",
      source_key: "spc",
      behavior: {
        kind: "tap_hold",
        tap: { kind: "key", key: "spc" },
        hold: { kind: "hold_layer", target: "layer-nav" },
        timeout_ms: 200,
      },
    },
    {
      layer_id: "layer-nav",
      source_key: "h",
      behavior: { kind: "key", key: "left" },
    },
  ],
  settings: { version: 1 },
  created_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-30T09:14:00Z",
};

type Fixture = {
  workspace: ManagerWorkspace;
  geometry: GeometryTemplate;
  profile: Profile;
};

async function openEditor(page: Page, fixture: Partial<Fixture> = {}) {
  await page.addInitScript(
    ({ workspace, geometry, profile }: Fixture) => {
      let draft = profile;
      localStorage.setItem("keyboardeer-first-run-complete", "1");
      window.runtime = { EventsOn: () => () => {} };
      window.go = {
        main: {
          App: {
            Info: async () => ({ name: "KeyboarDeer", version: "test" }),
            Workspace: async () => workspace,
            Profiles: async () => [draft],
            SelectedProfiles: async () => ({ [draft.device_id]: draft.id }),
            Geometries: async () => [geometry],
            SaveProfile: async (value) => {
              draft = { ...value, draft_revision: value.draft_revision + 1 };
              return draft;
            },
            PreviewProfile: async (id) => ({
              profile_id: id,
              draft_revision: draft.draft_revision,
              device_id: draft.device_id,
              manager_server_id: "server-1",
              state_revision: 1,
              validation: {
                outcome: "valid",
                reason_code: "validation_succeeded",
                reason: "Valid",
                diagnostics: null,
              },
              source_map: [],
            }),
          },
        },
      };
    },
    { workspace, geometry: tkl, profile, ...fixture },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Edit draft" }).click();
  await expect(page.locator(".editor-key")).toHaveCount(tkl.keys.length);
}

async function expectWholeKeyboardVisible(page: Page) {
  const region = await page.locator(".editor-scroll-region").boundingBox();
  const keyboard = await page.locator(".keyboard-editor").boundingBox();
  const palette = await page.locator(".key-palette").boundingBox();
  expect(region && keyboard && palette).toBeTruthy();
  expect(keyboard!.y).toBeGreaterThanOrEqual(region!.y);
  expect(keyboard!.y + keyboard!.height).toBeLessThanOrEqual(
    region!.y + region!.height + 1,
  );
  expect(keyboard!.y + keyboard!.height).toBeLessThanOrEqual(palette!.y + 1);
  // Every key can be hit where it is drawn; nothing paints over it.
  const covered = await page.locator(".editor-key").evaluateAll((keys) =>
    keys
      .filter((key) => {
        const box = key.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return !hit || !key.contains(hit);
      })
      .map((key) => (key as HTMLElement).dataset.sourceKey),
  );
  expect(covered).toEqual([]);
}

for (const [width, height, compact] of [
  [1180, 820, true], // the default desktop window from main.go
  [1440, 900, true],
  [1920, 1080, false],
  [760, 600, true], // the minimum desktop window
] as const) {
  test(`shows the whole keyboard at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openEditor(page);
    const editorPage = page.locator(".editor-page");
    if (compact) await expect(editorPage).toHaveClass(/compact-palette/);
    else await expect(editorPage).not.toHaveClass(/compact-palette/);
    if (height >= 820) await expectWholeKeyboardVisible(page);
    else {
      // The minimum window cannot fit everything; the keyboard scrolls inside
      // its own region and is never painted under the palette.
      const region = await page.locator(".editor-scroll-region").boundingBox();
      expect(region!.height).toBeGreaterThan(200);
    }
    const palette = await page.locator(".key-palette").boundingBox();
    expect(palette!.y + palette!.height).toBeLessThanOrEqual(height + 1);
    await page.locator('[data-source-key="caps"]').click();
    await page.getByRole("button", { name: "Tap & hold" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}
