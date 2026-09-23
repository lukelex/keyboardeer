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
    capabilities: ["device_discovery", "device_identification"].map((name) => ({
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

test("real null-slice shapes render devices and allow the first draft edit", async ({
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
    .locator(".palette-buttons")
    .getByRole("button", { name: "esc", exact: true })
    .click();
  await expect(
    page.getByText("Base layer · saved locally · revision 2"),
  ).toBeVisible();
  await expect(page.locator(".editor-key small")).toHaveText("esc");
  await page.getByRole("button", { name: "← All keyboards" }).click();
  await expect(
    page.getByRole("heading", { name: "Unconfigured keyboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit draft", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
