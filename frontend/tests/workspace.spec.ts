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
    configurations: null,
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
              ],
            },
          ],
          CreateProfile: async (deviceID, name, geometryID) => {
            draft = {
              id: "draft-1",
              name,
              device_id: deviceID,
              draft_revision: 1,
              geometry: { id: geometryID, source_keys: ["caps"] },
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
        },
      },
    };
  }, workspace);
  await page.goto("/");
  await expect(page.getByText("Manager ready", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Identify", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.locator(".editor-key")).toHaveCount(1);
  await page
    .locator('.palette-buttons button[title="Assign Caps (caps)"]')
    .click();
  await expect(
    page.getByText("Base layer · saved locally · revision 2"),
  ).toBeVisible();
  await expect(page.locator(".editor-key small")).toHaveText("caps");
  await expect(
    page.getByText("Manager preview: Valid", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review & apply" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready to make it live?" }),
  ).toBeVisible();
  await page
    .getByText("I understand this changes the live mapping for this keyboard.")
    .click();
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
  expect(errors).toEqual([]);
});
