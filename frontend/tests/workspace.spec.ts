import { expect, test } from "@playwright/test";
import type { ManagerWorkspace, Profile } from "../src/desktop";

// Nil Go slices are JSON null, including configured_by on actual unconfigured
// devices and assignments in freshly created local profiles.
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
    ].map((name) => ({
      name,
      available: true,
      reason_code: "capability_available",
      reason: "Available",
    })),
  },
  snapshot: {
    state_revision: 1,
    event_cursor: { server_id: "server-1", event_id: 0, state_revision: 1 },
    devices: [
      {
        id: "device-1",
        display_name: "Unconfigured keyboard",
        availability: "connected",
        identity_stability: "topology",
        configured_by: null,
        runtime_conflict: false,
        reason_code: "device_connected",
        reason: "Connected",
      },
    ],
    configurations: [
      {
        id: "cfg-1",
        name: "Managed fixture",
        ownership: "managed",
        enabled: true,
        device_id: "device-1",
        desired_revision: 7,
        active_revision: 7,
        runtime: {
          phase: "running",
          reason_code: "runtime_running",
          reason: "Running",
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

test("null Go slices support editing, previewing, and explicitly applying a draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((workspace) => {
    let draft: Profile | undefined;
    let receiveWorkspace: ((value: unknown) => void) | undefined;
    window.runtime = {
      EventsOn: (_, callback) => {
        receiveWorkspace = callback;
        return () => {
          receiveWorkspace = undefined;
        };
      },
    };
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => workspace,
          Profiles: async () => (draft ? [draft] : []),
          Geometries: async () => [
            {
              id: "fixture",
              name: "Fixture layout",
              description: "Explicit test geometry",
              keys: [
                {
                  id: "caps",
                  label: "Caps",
                  source_key: "caps",
                  row: 0,
                  width: 1,
                },
                {
                  id: "z",
                  label: "Z",
                  source_key: "z",
                  row: 1,
                  width: 1,
                },
                {
                  id: "left-control",
                  label: "Ctrl",
                  source_key: "lctl",
                  row: 1,
                  width: 1.3,
                },
                {
                  id: "digit-2",
                  label: "2",
                  source_key: "2",
                  row: 2,
                  width: 1,
                },
                {
                  id: "a",
                  label: "A",
                  source_key: "a",
                  row: 2,
                  width: 1,
                },
              ],
            },
          ],
          CreateProfile: async (deviceID, name, geometryID) => {
            draft = {
              id: "draft-1",
              name,
              device_id: deviceID,
              draft_revision: 1,
              geometry: {
                id: geometryID,
                source_keys: ["caps", "z", "lctl", "2", "a"],
              },
              layers: [{ id: "base", name: "Base" }],
              assignments: null,
              settings: { version: 1 },
              created_at: "2026-09-23T00:00:00Z",
              updated_at: "2026-09-23T00:00:00Z",
            };
            return draft;
          },
          SaveProfile: async (value) => {
            draft = { ...value, draft_revision: value.draft_revision + 1 };
            receiveWorkspace?.(workspace);
            return draft;
          },
          PreviewProfile: async (id) => ({
            profile_id: id,
            draft_revision: draft!.draft_revision,
            device_id: "device-1",
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
          ApplyProfile: async (id) => {
            draft = { ...draft!, manager_configuration_id: "cfg-1" };
            return {
              profile: draft,
              operation: {
                id: "op-1",
                kind: "apply",
                state: "succeeded",
                resource: { kind: "configuration", id: "cfg-1" },
                reason_code: "operation_succeeded",
                reason: "configuration persisted and activation confirmed",
              },
            };
          },
          SetConfigurationEnabled: async (configurationID, enabled) => {
            const configuration = workspace.snapshot?.configurations?.find(
              (item) => item.id === configurationID,
            );
            if (configuration) {
              configuration.enabled = enabled;
              configuration.desired_revision += 1;
            }
            return {
              id: "op-lifecycle-1",
              kind: "lifecycle",
              state: "succeeded",
              resource: { kind: "configuration", id: configurationID },
              reason_code: "operation_succeeded",
              reason: enabled
                ? "configuration enabled"
                : "configuration disabled and its KMonad process stopped",
              configuration_revision: 8,
            };
          },
        },
      },
    };
  }, workspace);
  await page.goto("/");
  await expect(page.getByText("Manager ready", { exact: true })).toBeVisible();
  const identify = page.getByRole("button", { name: "Identify", exact: true });
  await expect(identify).toBeEnabled();
  await expect(identify).toHaveAttribute("title", "Identify this keyboard");
  await expect(identify.locator("svg")).toBeVisible();
  await identify.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Close keyboard identification" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const bindings = page.getByRole("checkbox", {
    name: "Enable bindings for Managed fixture",
  });
  await bindings.uncheck();
  await expect(
    page.getByText(
      "Manager disabled bindings: configuration disabled and its KMonad process stopped",
    ),
  ).toBeVisible();
  await expect(bindings).not.toBeChecked();
  await expect(
    page.getByText("Bindings disabled", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.locator(".app-header")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "← All keyboards", exact: true }),
  ).toBeVisible();
  const editorHeading = await page.locator(".editor-heading").boundingBox();
  expect(editorHeading).not.toBeNull();
  expect(Math.round(editorHeading!.height)).toBeGreaterThanOrEqual(54);
  await expect(page.locator(".editor-key")).toHaveCount(5);
  const firstEditorKey = await page
    .locator(".editor-key")
    .first()
    .boundingBox();
  expect(firstEditorKey).not.toBeNull();
  expect(Math.round(firstEditorKey!.width)).toBe(42);
  expect(Math.round(firstEditorKey!.height)).toBe(42);
  await expect(page.locator(".editor-scroll-region")).toHaveCSS(
    "overflow-y",
    "auto",
  );
  const palette = await page.locator(".key-palette").boundingBox();
  const viewport = page.viewportSize();
  expect(palette).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(palette!.x).toBe(0);
  expect(Math.round(palette!.width)).toBe(viewport!.width);
  expect(Math.round(palette!.y + palette!.height)).toBe(viewport!.height);
  const paletteKeys = page.locator(".palette-key");
  await expect(paletteKeys).toHaveCount(5);
  expect(
    await paletteKeys.evaluateAll((keys) =>
      keys.map((key) => key.getAttribute("title")),
    ),
  ).toEqual([
    "Assign 2 (2)",
    "Assign A (a)",
    "Assign Z (z)",
    "Assign Caps (caps)",
    "Assign Ctrl (lctl)",
  ]);
  expect(
    await paletteKeys.evaluateAll((keys) =>
      keys.map((key) => Math.round(key.getBoundingClientRect().width)),
    ),
  ).toEqual([52, 52, 52, 52, 52]);
  await expect(page.getByText("SELECTED KEY", { exact: true })).toHaveCount(0);
  await page.keyboard.press("CapsLock");
  await expect(page.locator(".editor-key").first()).toHaveClass(/flashing-key/);
  await page.locator(".editor-key").first().click();
  await page.getByRole("button", { name: "Tap & hold" }).click();
  await expect(page.getByRole("heading", { name: "Tap & hold" })).toBeVisible();
  await page
    .getByRole("button", { name: "Close complex action dialog" })
    .click();
  await page
    .locator('.palette-buttons button[title="Assign Caps (caps)"]')
    .click();
  await expect(
    page.getByRole("heading", { name: "Unconfigured keyboard draft" }),
  ).toBeVisible();
  await expect(page.locator(".editor-key").first().locator("small")).toHaveText(
    "caps",
  );
  await page.getByRole("button", { name: "Disable selected key" }).click();
  await expect(page.locator(".editor-key").first().locator("small")).toHaveText(
    "Disabled",
  );
  await page.getByRole("button", { name: "Restore original" }).click();
  await expect(page.locator(".editor-key").first().locator("small")).toHaveText(
    "caps",
  );
  await expect(page.locator(".configuration-indicator.valid")).toBeVisible();
  await expect(
    page.getByText("Manager preview: Valid", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("MANAGED APPLY", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Apply to keyboard" }).click();
  await expect(
    page.getByText(
      "Manager Apply: Succeeded — configuration persisted and activation confirmed",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "← All keyboards" }).click();
  await expect(
    page.getByRole("heading", { name: "Unconfigured keyboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit draft", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Set up", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("hides manager output devices while retaining legacy role-less inputs", async ({
  page,
}) => {
  const mixedWorkspace: ManagerWorkspace = structuredClone(workspace);
  mixedWorkspace.snapshot!.devices = [
    {
      ...workspace.snapshot!.devices![0],
      id: "input-device",
      display_name: "Physical keyboard",
      role: "input",
    },
    {
      ...workspace.snapshot!.devices![0],
      id: "manager-output",
      display_name: "kmonad-device-manager-2438b2cc423091fb",
      role: "manager_output",
    },
    {
      ...workspace.snapshot!.devices![0],
      id: "legacy-device",
      display_name: "Legacy keyboard",
    },
  ];
  await page.addInitScript((fixture) => {
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => fixture,
          Profiles: async () => [],
          Geometries: async () => [],
        },
      },
    };
  }, mixedWorkspace);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Physical keyboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Legacy keyboard" }),
  ).toBeVisible();
  await expect(
    page.getByText("kmonad-device-manager-2438b2cc423091fb"),
  ).toHaveCount(0);
  await expect(page.getByText("Not set up yet", { exact: true })).toBeVisible();
  await expect(page.getByText("2 known", { exact: true })).toBeVisible();
});
