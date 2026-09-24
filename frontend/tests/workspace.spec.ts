import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { formatKMonad } from "../src/kmonadFormat";
import type { ManagerWorkspace, Profile, ProfilePreview } from "../src/desktop";
import {
  applyAssignmentRecovery,
  assignmentRecovery,
  mapDiagnosticToAssignment,
} from "../src/validationRecovery";

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
      "configuration_export",
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

test("pretty-prints KMonad forms without splitting quoted delimiters", () => {
  expect(formatKMonad('(defcfg input (device-file "keyboard (left)"))')).toBe(
    '(defcfg\n  input\n  (device-file\n    "keyboard (left)"\n  )\n)',
  );
});

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
          ExportConfiguration: async (configurationID) => ({
            configuration_id: configurationID,
            revision: 1,
            digest: "sha256:fixture",
            format: "manager_rendered_kbd",
            content: '(defcfg\n  input (device-file "/dev/input/event0"))',
          }),
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
          IdentifyStart: async (_, timeoutMS) => ({
            id: "identify-1",
            kind: "identify",
            state: "waiting",
            reason_code: "operation_waiting",
            reason: `Waiting up to ${timeoutMS} milliseconds for a keypress.`,
          }),
          IdentifyOperation: async () => ({
            id: "identify-1",
            kind: "identify",
            state: "waiting",
            reason_code: "operation_waiting",
            reason: "Waiting for a keypress.",
          }),
          IdentifyCancel: async () => ({
            id: "identify-1",
            kind: "identify",
            state: "cancelled",
            reason_code: "operation_cancelled",
            reason: "Identification was cancelled.",
          }),
        },
      },
    };
  }, workspace);
  await page.goto("/");
  await expect(page.getByText("Manager ready", { exact: true })).toBeVisible();
  const configurationState = page.locator(".configuration-state");
  await expect(configurationState).toContainText("Managed fixture");
  await expect(configurationState).toContainText("Desired");
  await expect(configurationState).toContainText("Active");
  await expect(configurationState).toContainText("Healthy");
  const identify = page.getByRole("button", { name: "Identify", exact: true });
  await expect(identify).toBeEnabled();
  await expect(identify).toHaveAttribute("title", "Identify this keyboard");
  await expect(identify.locator("svg")).toBeVisible();
  await identify.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Session length").selectOption("5000");
  await page
    .getByRole("button", { name: "Start 5-second identification" })
    .click();
  await expect(page.getByText(/remaining$/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
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
  const editorTextContrasts = await page
    .locator(".editor-page")
    .evaluate((root) => {
      const luminance = (color: string) => {
        const channels =
          color
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number) ?? [];
        const linear = channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const contrast = (foreground: string, background: string) => {
        const values = [luminance(foreground), luminance(background)].sort(
          (a, b) => b - a,
        );
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      const buttons = [
        ...root.querySelectorAll<HTMLButtonElement>(".button.secondary"),
      ].map((button) => {
        const style = getComputedStyle(button);
        return contrast(style.color, style.backgroundColor);
      });
      const smallLabels = [
        ...root.querySelectorAll<HTMLElement>(
          ".editor-key small, .palette-key small",
        ),
      ].map((label) => {
        const parent = getComputedStyle(label.parentElement!);
        return contrast(getComputedStyle(label).color, parent.backgroundColor);
      });
      return [...buttons, ...smallLabels];
    });
  expect(editorTextContrasts.every((ratio) => ratio >= 4.5)).toBe(true);
  await expect(page.locator(".configuration-indicator i")).toBeVisible();
  await expect(page.locator(".editor-heading > button").last()).toHaveText(
    "Apply to keyboard",
  );
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
  await expect(paletteKeys).toHaveCount(46);
  expect(
    await paletteKeys.evaluateAll((keys) =>
      keys.slice(0, 5).map((key) => key.getAttribute("title")),
    ),
  ).toEqual(["2 (2)", "A (a)", "Z (z)", "Caps (caps)", "Ctrl (lctl)"]);
  expect(
    await paletteKeys.evaluateAll((keys) =>
      keys
        .slice(0, 5)
        .map((key) => Math.round(key.getBoundingClientRect().width)),
    ),
  ).toEqual([52, 52, 52, 52, 52]);
  await expect(page.getByText("SELECTED KEY", { exact: true })).toHaveCount(0);
  await page.keyboard.press("CapsLock");
  await expect(page.locator(".editor-key").first()).toHaveClass(/flashing-key/);
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(
    page.getByRole("heading", { name: "Manage layers" }),
  ).toBeVisible();
  await page.getByLabel("Add a layer").fill("Navigation");
  await page.getByRole("button", { name: "Add layer" }).click();
  await expect(
    page.locator(".layer-tabs").getByRole("tab", { name: "Navigation" }),
  ).toBeVisible();
  await expect(page.getByText("Layer entry and exit")).toBeVisible();
  await page
    .getByRole("button", { name: "Close complex action dialog" })
    .click();
  const visualizedKey = page.locator(".editor-key").first();
  await page.locator(".layer-tabs").getByRole("tab", { name: "Base" }).click();
  const baseLayerMapping = await visualizedKey.locator("small").innerText();
  await page
    .locator(".layer-tabs")
    .getByRole("tab", { name: "Navigation" })
    .click();
  await visualizedKey.click();
  await expect(
    page.locator(
      '.palette-key[aria-label="Assign Next track (next)"] .palette-symbol',
    ),
  ).toHaveText("⏭");
  await expect(
    page.locator('.palette-key[aria-label="Assign Next track (next)"]'),
  ).toHaveAttribute("title", "Next track (next)");
  await expect(
    page.locator('.palette-key[aria-label="Assign Brightness up (brup)"]'),
  ).toHaveAttribute("title", "Brightness up (brup)");
  await expect(
    page.locator(
      '.palette-key[aria-label="Assign Brightness up (brup)"] .palette-symbol',
    ),
  ).toHaveText("☀+");
  await expect(
    page.locator(
      '.palette-key[aria-label="Assign Keyboard backlight toggle (kbdillumtoggle)"] .palette-symbol',
    ),
  ).toHaveText("⌨☼");
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await expect(visualizedKey.locator("small")).toHaveText("a");
  await page.locator(".layer-tabs").getByRole("tab", { name: "Base" }).click();
  await expect(visualizedKey.locator("small")).toHaveText(baseLayerMapping);
  await page
    .locator(".layer-tabs")
    .getByRole("tab", { name: "Navigation" })
    .click();
  await expect(visualizedKey.locator("small")).toHaveText("a");
  await page.locator(".layer-tabs").getByRole("tab", { name: "Base" }).click();
  await visualizedKey.click();
  await page.locator(".editor-key").first().click();
  await page.getByRole("button", { name: "Layer action" }).click();
  await expect(
    page.getByRole("heading", { name: "Layer action" }),
  ).toBeVisible();
  await expect(page.getByText("Layer entry and exit")).toBeVisible();
  await page
    .getByRole("button", { name: "Close complex action dialog" })
    .click();
  await page
    .locator(".layer-tabs")
    .getByRole("tab", { name: "Navigation" })
    .click();
  await page.getByRole("button", { name: "Pass through", exact: true }).click();
  await expect(page.locator(".editor-key").first().locator("small")).toHaveText(
    "Pass through",
  );
  await page.getByRole("button", { name: "Restore original" }).click();
  await expect(page.locator(".editor-key").first().locator("small")).toHaveText(
    "Pass through",
  );
  await page.locator(".layer-tabs").getByRole("tab", { name: "Base" }).click();
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(
    page.getByRole("heading", { name: "Manage layers" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Navigation No entry action" })
    .click();
  await expect(
    page.getByRole("button", { name: "Move earlier" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move later" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Delete layer" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Delete layer" }),
  ).toHaveAttribute("title", "Delete this empty, unreferenced layer.");
  await page.getByLabel("Rename selected layer").fill("Nav");
  await page.getByRole("button", { name: "Rename layer" }).click();
  await expect(
    page.getByRole("tab", { name: "Nav", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close complex action dialog" })
    .click();
  await page.locator(".layer-tabs").getByRole("tab", { name: "Base" }).click();
  await page.getByRole("button", { name: "Tap & hold" }).click();
  await expect(page.getByRole("heading", { name: "Tap & hold" })).toBeVisible();
  await expect(page.getByText("200 ms default:")).toBeVisible();
  await page
    .getByRole("button", { name: "Close complex action dialog" })
    .click();
  await page
    .locator('.palette-buttons button[aria-label="Assign Caps (caps)"]')
    .click();
  await expect(
    page.getByRole("heading", { name: "Unconfigured keyboard draft" }),
  ).toBeVisible();
  await expect(page.locator(".editor-key").first().locator("small")).toHaveText(
    "caps",
  );
  await page.getByRole("button", { name: "Disable selected key" }).click();
  const disabledKey = page.locator(".editor-key").first();
  await expect(disabledKey.locator("small")).toHaveText("No output");
  await expect(disabledKey).toHaveClass(/disabled-key/);
  await expect(disabledKey).toHaveAttribute(
    "title",
    "Disabled on Base layer: this key sends no input and blocks lower layers.",
  );
  await expect(disabledKey).toHaveCSS("background-color", "rgb(229, 232, 226)");
  expect(
    await disabledKey.evaluate(
      (key) => getComputedStyle(key, "::after").content,
    ),
  ).toBe('"×"');
  await page.getByRole("button", { name: "Restore original" }).click();
  const capsBehavior = page.locator(".editor-key").first().locator("small");
  await expect(capsBehavior).toHaveText("caps");
  await expect(disabledKey).not.toHaveClass(/disabled-key/);
  await expect(page.locator(".draft-status")).toContainText("Draft saved");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(capsBehavior).toHaveText("No output");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(capsBehavior).toHaveText("caps");
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Control+z");
  await expect(capsBehavior).toHaveText("No output");
  await page.keyboard.press("Control+Shift+Z");
  await expect(capsBehavior).toHaveText("caps");
  const keySearch = page.getByLabel("Search keys");
  await keySearch.fill("ctr");
  await expect(paletteKeys).toHaveCount(1);
  await expect(paletteKeys.first()).toHaveAttribute("title", "Ctrl (lctl)");
  await keySearch.fill("f24");
  await expect(paletteKeys).toHaveCount(1);
  await expect(paletteKeys.first()).toHaveAttribute("title", "F24 (f24)");
  await keySearch.fill("scrlck");
  await expect(paletteKeys).toHaveCount(1);
  await expect(paletteKeys.first()).toHaveAttribute(
    "title",
    "Scroll Lock (scrlck)",
  );
  await keySearch.fill("volu");
  await expect(paletteKeys).toHaveCount(2);
  expect(
    await paletteKeys.evaluateAll((keys) =>
      keys.map((key) => key.getAttribute("title")),
    ),
  ).toEqual(["Volume down (voldwn)", "Volume up (volu)"]);
  await keySearch.fill("zzz");
  await expect(paletteKeys).toHaveCount(0);
  await expect(page.getByText("No keys match “zzz”.")).toBeVisible();
  await keySearch.fill("");
  await expect(paletteKeys).toHaveCount(46);
  const originalViewport = page.viewportSize();
  expect(originalViewport).not.toBeNull();
  await page.setViewportSize({ width: originalViewport!.width, height: 600 });
  const categories = page.getByRole("tablist", { name: "Key categories" });
  await expect(categories).toBeVisible();
  await expect(paletteKeys).toHaveCount(46);
  const shortViewportRows = await paletteKeys.evaluateAll((keys) =>
    keys.map((key) => Math.round(key.getBoundingClientRect().top)),
  );
  expect(new Set(shortViewportRows).size).toBe(1);
  const paletteScroll = page.locator(".palette-buttons");
  const paletteScrollSize = await paletteScroll.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(paletteScrollSize.scrollWidth).toBeGreaterThan(
    paletteScrollSize.clientWidth,
  );
  await paletteScroll.evaluate((element) => (element.scrollLeft = 160));
  expect(await paletteScroll.evaluate((element) => element.scrollLeft)).toBe(
    160,
  );
  await paletteScroll.evaluate((element) => (element.scrollLeft = 0));
  await paletteScroll.hover();
  await page.mouse.wheel(0, 160);
  await expect
    .poll(() => paletteScroll.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await categories.getByRole("tab", { name: "Function" }).click();
  await expect(paletteKeys).toHaveCount(24);
  const functionKeyRows = await paletteKeys.evaluateAll((keys) =>
    keys.map((key) => Math.round(key.getBoundingClientRect().top)),
  );
  expect(new Set(functionKeyRows).size).toBe(1);
  const keyboardBottom = await page
    .locator(".keyboard-editor")
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const paletteTop = await page
    .locator(".key-palette")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(keyboardBottom).toBeLessThanOrEqual(paletteTop);
  await page.setViewportSize(originalViewport!);
  const indicator = page.locator(".configuration-indicator");
  await expect(indicator).toHaveAttribute("data-state", "valid");
  await expect(indicator).toHaveAccessibleName("Valid configuration");
  await expect(indicator).toHaveCSS("color", "rgb(53, 107, 67)");
  await expect(indicator.locator("i")).toHaveCSS(
    "background-color",
    "rgb(47, 138, 75)",
  );
  await expect(page.getByText("MANAGED PROFILE")).toHaveCount(0);
  await expect(page.getByText("DRAFT ONLY")).toHaveCount(0);
  await expect(
    page.getByText("Manager preview: Valid", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("MANAGED APPLY", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Apply to keyboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready to send this draft?" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply to keyboard" })
    .click();
  await expect(
    page.getByText(
      "Manager Apply: Succeeded — configuration persisted and activation confirmed",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "View .kbd" }).click();
  await expect(
    page.getByRole("heading", { name: "KMonad configuration" }),
  ).toBeVisible();
  await expect(page.locator(".raw-configuration-content")).toHaveText(
    '(defcfg\n  input\n  (device-file\n    "/dev/input/event0"\n  )\n)',
  );
  await expect(page.getByText(/Revision 1 · manager_rendered_kbd/)).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Close KMonad configuration" })
    .click();
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

test("reverts only an exactly mapped bad assignment to its persisted validated value", async ({
  page,
}) => {
  const state: ManagerWorkspace = structuredClone(workspace);
  state.snapshot!.configurations = [];
  await page.addInitScript((fixture) => {
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    const now = "2026-09-24T10:00:00Z";
    let draft: Profile | undefined;
    let validationMode: "mapped" | "unmapped" | "blocked" = "mapped";
    const sourceMap = [
      {
        layer_id: "base",
        source_key: "caps",
        explicit: true,
        span: {
          start_line: 4,
          start_column: 3,
          end_line: 4,
          end_column: 6,
        },
      },
    ];
    const validPreview = (): ProfilePreview => {
      if (!draft) throw new Error("recovery draft has not been created");
      const candidateDigest = `sha256:${draft.draft_revision
        .toString(16)
        .padStart(64, "0")}`;
      draft.validation_recovery = {
        checkpoint: {
          draft_revision: draft.draft_revision,
          manager_server_id: "server-1",
          candidate_digest: candidateDigest,
          geometry: clone(draft.geometry),
          layers: clone(draft.layers),
          assignments: clone(draft.assignments),
          aliases: draft.aliases,
          macros: draft.macros,
        },
        pre_edit: [],
      };
      return {
        profile_id: draft.id,
        draft_revision: draft.draft_revision,
        device_id: draft.device_id,
        manager_server_id: "server-1",
        state_revision: 1,
        candidate_digest: candidateDigest,
        validation_recovery: clone(draft.validation_recovery),
        validation: {
          outcome: "valid",
          reason_code: "validation_succeeded",
          reason: "Whole draft is valid.",
          candidate_digest: candidateDigest,
          diagnostics: [],
        },
        source_map: sourceMap,
      };
    };
    const rejectedPreview = (): ProfilePreview => {
      if (!draft) throw new Error("recovery draft has not been created");
      const candidateDigest = `sha256:${"f".repeat(64)}`;
      const blocked = validationMode === "blocked";
      const location =
        validationMode === "mapped"
          ? {
              scope: "submitted_behavior",
              start_line: 4,
              start_column: 3,
              end_line: 4,
              end_column: 4,
            }
          : undefined;
      return {
        profile_id: draft.id,
        draft_revision: draft.draft_revision,
        device_id: draft.device_id,
        manager_server_id: "server-1",
        state_revision: 1,
        candidate_digest: candidateDigest,
        validation_recovery: clone(draft.validation_recovery),
        validation: {
          outcome: blocked ? "blocked" : "rejected",
          reason_code: blocked ? "device_disconnected" : "validation_failed",
          reason: blocked
            ? "The keyboard disconnected during validation."
            : "The manager rejected the Caps assignment.",
          candidate_digest: candidateDigest,
          diagnostics: [
            {
              id: "bad-caps",
              severity: blocked ? "temporary" : "error",
              reason_code: blocked ? "device_disconnected" : "unknown_alias",
              summary: blocked
                ? "The keyboard is unavailable."
                : "The Caps action is invalid.",
              remediation: blocked
                ? "Reconnect the keyboard and retry."
                : "Restore the last validated assignment.",
              ...(location ? { location } : {}),
            },
          ],
        },
        source_map: sourceMap,
      };
    };
    (window as any).__recoveryDraft = () => clone(draft);
    (window as any).__setValidationMode = (mode: typeof validationMode) => {
      validationMode = mode;
    };
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => fixture,
          Profiles: async () => (draft ? [clone(draft)] : []),
          SelectedProfiles: async () => (draft ? { "device-1": draft.id } : {}),
          Geometries: async () => [
            {
              id: "recovery-layout",
              name: "Recovery layout",
              description: "Two-key recovery fixture",
              keys: [
                {
                  id: "caps",
                  label: "Caps",
                  source_key: "caps",
                  row: 0,
                  width: 1,
                },
                {
                  id: "a",
                  label: "A",
                  source_key: "a",
                  row: 0,
                  width: 1,
                },
              ],
            },
          ],
          CreateProfile: async (deviceID, name, geometryID) => {
            draft = {
              id: "recovery-profile",
              name,
              device_id: deviceID,
              draft_revision: 1,
              geometry: { id: geometryID, source_keys: ["caps", "a"] },
              layers: [{ id: "base", name: "Base" }],
              assignments: [
                {
                  layer_id: "base",
                  source_key: "caps",
                  behavior: { kind: "key", key: "esc" },
                },
                {
                  layer_id: "base",
                  source_key: "a",
                  behavior: { kind: "key", key: "b" },
                },
              ],
              settings: { version: 1 },
              created_at: now,
              updated_at: now,
            };
            return clone(draft);
          },
          SaveProfile: async (value) => {
            if (!draft) throw new Error("recovery draft has not been created");
            draft = {
              ...clone(value),
              draft_revision: draft.draft_revision + 1,
              updated_at: new Date().toISOString(),
            };
            return clone(draft);
          },
          PreviewProfile: async () =>
            draft?.assignments?.find(
              (assignment) =>
                assignment.layer_id === "base" &&
                assignment.source_key === "caps",
            )?.behavior.key === "a"
              ? rejectedPreview()
              : validPreview(),
        },
      },
    };
  }, state);

  await page.goto("/");
  await expect(page.getByText("Manager ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.locator(".configuration-indicator")).toHaveAttribute(
    "data-state",
    "valid",
  );
  await page.locator('.editor-key[data-source-key="caps"]').click();
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await expect(page.locator(".preview-message")).toContainText(
    "The manager rejected the Caps assignment.",
  );
  const invalidKey = page.locator('.editor-key[data-source-key="caps"]');
  await expect(invalidKey).toHaveClass(/invalid-key/);
  await page.getByRole("button", { name: "Show Base · caps" }).click();
  await expect(invalidKey).toBeFocused();
  await page.getByRole("button", { name: "Revert caps" }).click();
  await expect(invalidKey.locator("small")).toHaveText("esc");
  await expect(page.locator(".configuration-indicator")).toHaveAttribute(
    "data-state",
    "valid",
  );
  const restored = await page.evaluate(() => (window as any).__recoveryDraft());
  expect(restored.assignments).toContainEqual({
    layer_id: "base",
    source_key: "caps",
    behavior: { kind: "key", key: "esc" },
  });
  expect(restored.assignments).toContainEqual({
    layer_id: "base",
    source_key: "a",
    behavior: { kind: "key", key: "b" },
  });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(invalidKey.locator("small")).toHaveText("a");
  await expect(page.locator(".preview-message")).toContainText(
    "The manager rejected the Caps assignment.",
  );
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(invalidKey.locator("small")).toHaveText("esc");
  await expect(page.locator(".configuration-indicator")).toHaveAttribute(
    "data-state",
    "valid",
  );

  // A fresh bad edit after revalidation gets a new checkpoint and can be
  // safely recovered again.
  await page.evaluate(() => (window as any).__setValidationMode("mapped"));
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await expect(invalidKey).toHaveClass(/invalid-key/);
  await page.getByRole("button", { name: "Revert caps" }).click();
  await expect(invalidKey.locator("small")).toHaveText("esc");
  await expect(page.locator(".configuration-indicator")).toHaveAttribute(
    "data-state",
    "valid",
  );

  await page.evaluate(() => (window as any).__setValidationMode("unmapped"));
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await expect(page.locator(".preview-message")).toContainText(
    "No exact manager location matched one assignment",
  );
  await expect(invalidKey).not.toHaveClass(/invalid-key/);
  await expect(
    page.getByRole("button", { name: "Show Base · caps" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revert caps" })).toHaveCount(
    0,
  );

  await page.evaluate(() => (window as any).__setValidationMode("blocked"));
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await expect(page.locator(".preview-message.blocked")).toContainText(
    "The keyboard disconnected during validation.",
  );
  await expect(invalidKey).not.toHaveClass(/invalid-key/);
  await expect(
    page.getByRole("button", { name: "Show Base · caps" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revert caps" })).toHaveCount(
    0,
  );
});

test("fails closed for blocked, unknown-scope, mismatched-digest, and ambiguous locations", async () => {
  const profile: Profile = {
    id: "profile",
    name: "Fixture",
    device_id: "device",
    draft_revision: 2,
    geometry: { id: "layout", source_keys: ["caps"] },
    layers: [{ id: "base", name: "Base" }],
    assignments: [
      {
        layer_id: "base",
        source_key: "caps",
        behavior: { kind: "key", key: "a" },
      },
    ],
    settings: { version: 1 },
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
  };
  const entry = {
    layer_id: "base",
    source_key: "caps",
    explicit: true,
    span: { start_line: 2, start_column: 3, end_line: 2, end_column: 4 },
  };
  const preview: ProfilePreview = {
    profile_id: profile.id,
    draft_revision: profile.draft_revision,
    device_id: profile.device_id,
    manager_server_id: "server",
    state_revision: 1,
    candidate_digest: `sha256:${"a".repeat(64)}`,
    validation: {
      outcome: "rejected",
      reason_code: "validation_failed",
      reason: "Rejected",
      candidate_digest: `sha256:${"a".repeat(64)}`,
      diagnostics: [],
    },
    source_map: [entry],
  };
  const diagnostic = {
    id: "diagnostic",
    severity: "error",
    reason_code: "invalid",
    summary: "Invalid key",
    remediation: "Fix the key",
    location: {
      scope: "submitted_behavior",
      start_line: 2,
      start_column: 3,
      end_line: 2,
      end_column: 4,
    },
  };
  expect(
    mapDiagnosticToAssignment(
      { ...preview, validation: { ...preview.validation, outcome: "blocked" } },
      diagnostic,
      profile,
    ),
  ).toBeNull();
  expect(
    mapDiagnosticToAssignment(
      preview,
      {
        ...diagnostic,
        location: { ...diagnostic.location, scope: "generated_file" },
      },
      profile,
    ),
  ).toBeNull();
  expect(
    mapDiagnosticToAssignment(
      { ...preview, candidate_digest: `sha256:${"b".repeat(64)}` },
      diagnostic,
      profile,
    ),
  ).toBeNull();
  expect(
    mapDiagnosticToAssignment(
      {
        ...preview,
        validation: {
          ...preview.validation,
          candidate_digest: undefined,
        },
      },
      diagnostic,
      profile,
    ),
  ).toBeNull();
  expect(
    mapDiagnosticToAssignment(
      { ...preview, source_map: [entry, entry] },
      diagnostic,
      profile,
    ),
  ).toBeNull();
  expect(
    mapDiagnosticToAssignment(
      preview,
      {
        ...diagnostic,
        location: { ...diagnostic.location, start_line: 3, end_line: 3 },
      },
      profile,
    ),
  ).toBeNull();
});

test("uses safe pre-edit fallback without a checkpoint and protects removed dependencies", () => {
  const profile: Profile = {
    id: "profile",
    name: "Fixture",
    device_id: "device",
    draft_revision: 2,
    geometry: { id: "layout", source_keys: ["caps", "a"] },
    layers: [{ id: "base", name: "Base" }],
    assignments: [
      {
        layer_id: "base",
        source_key: "caps",
        behavior: { kind: "key", key: "a" },
      },
      {
        layer_id: "base",
        source_key: "a",
        behavior: { kind: "key", key: "b" },
      },
    ],
    settings: { version: 1 },
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
    validation_recovery: {
      pre_edit: [
        {
          geometry_id: "layout",
          layer_id: "base",
          source_key: "caps",
          had_assignment: true,
          behavior: { kind: "key", key: "esc" },
        },
      ],
    },
  };
  const sourceMap = [
    {
      layer_id: "base",
      source_key: "caps",
      explicit: true,
      span: { start_line: 2, start_column: 3, end_line: 2, end_column: 4 },
    },
  ];
  const candidateDigest = `sha256:${"c".repeat(64)}`;
  const preview: ProfilePreview = {
    profile_id: profile.id,
    draft_revision: profile.draft_revision,
    device_id: profile.device_id,
    manager_server_id: "server",
    state_revision: 1,
    candidate_digest: candidateDigest,
    validation: {
      outcome: "rejected",
      reason_code: "validation_failed",
      reason: "Rejected",
      candidate_digest: candidateDigest,
      diagnostics: [],
    },
    source_map: sourceMap,
  };
  const diagnostic = {
    id: "diagnostic",
    severity: "error",
    reason_code: "invalid",
    summary: "Invalid key",
    remediation: "Fix the key",
    location: {
      scope: "submitted_behavior",
      start_line: 2,
      start_column: 3,
      end_line: 2,
      end_column: 4,
    },
  };
  const issue = mapDiagnosticToAssignment(preview, diagnostic, profile);
  expect(issue).not.toBeNull();
  const recovery = assignmentRecovery(profile, issue!, "server");
  expect(recovery).toMatchObject({
    available: true,
    source: "before_edit",
    hadAssignment: true,
    behavior: { kind: "key", key: "esc" },
  });
  const reverted = applyAssignmentRecovery(profile, issue!, recovery);
  expect(reverted.assignments).toContainEqual({
    layer_id: "base",
    source_key: "caps",
    behavior: { kind: "key", key: "esc" },
  });
  expect(reverted.assignments).toContainEqual({
    layer_id: "base",
    source_key: "a",
    behavior: { kind: "key", key: "b" },
  });

  profile.validation_recovery.pre_edit![0].behavior = {
    kind: "hold_layer",
    target: "removed-layer",
  };
  const unsafe = assignmentRecovery(profile, issue!, "server");
  expect(unsafe.available).toBe(false);
  expect(unsafe.reason).toContain("removed layer");
  for (const behavior of [
    { kind: "alias", target: "removed-alias" },
    { kind: "macro", target: "removed-macro" },
  ]) {
    profile.validation_recovery.pre_edit![0].behavior = behavior;
    expect(assignmentRecovery(profile, issue!, "server").available).toBe(false);
  }

  const withoutProvenance = {
    ...profile,
    validation_recovery: undefined,
  };
  expect(
    assignmentRecovery(withoutProvenance, issue!, "server").available,
  ).toBe(false);
  const staleCheckpoint = {
    ...profile,
    validation_recovery: {
      checkpoint: {
        draft_revision: 1,
        manager_server_id: "old-server",
        candidate_digest: `sha256:${"a".repeat(64)}`,
        geometry: profile.geometry,
        layers: profile.layers,
        assignments: profile.assignments,
      },
      pre_edit: [],
    },
  };
  expect(assignmentRecovery(staleCheckpoint, issue!, "server").available).toBe(
    false,
  );
});

test("maps the manager JSON Lines validation fixture through one compiler span", () => {
  type ValidationFrame = {
    type: string;
    id: string;
    result?: { validation: ProfilePreview["validation"] };
  };
  const frames = readFileSync(
    new URL(
      "../../tests/fixtures/validation-preview-locations.jsonl",
      import.meta.url,
    ),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ValidationFrame);
  const responses = new Map(
    frames
      .filter((frame) => frame.type === "response" && frame.result)
      .map((frame) => [frame.id, frame.result!.validation]),
  );
  const profile: Profile = {
    id: "fixture-profile",
    name: "Fixture",
    device_id: "dev_fixture",
    draft_revision: 2,
    geometry: { id: "fixture-layout", source_keys: ["a"] },
    layers: [{ id: "base", name: "Base" }],
    assignments: [
      {
        layer_id: "base",
        source_key: "a",
        behavior: { kind: "key", key: "a" },
      },
    ],
    settings: { version: 1 },
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
  };
  const makePreview = (
    validation: ProfilePreview["validation"],
  ): ProfilePreview => ({
    profile_id: profile.id,
    draft_revision: profile.draft_revision,
    device_id: profile.device_id,
    manager_server_id: "server-1",
    state_revision: 1,
    candidate_digest: validation.candidate_digest ?? "",
    validation,
    source_map: [
      {
        layer_id: "base",
        source_key: "a",
        explicit: true,
        span: {
          start_line: 2,
          start_column: 16,
          end_line: 2,
          end_column: 30,
        },
      },
    ],
  });

  const mapped = responses.get("mapped-rejection");
  expect(mapped).toBeDefined();
  expect(
    mapDiagnosticToAssignment(
      makePreview(mapped!),
      mapped!.diagnostics![0],
      profile,
    ),
  ).toMatchObject({ layerID: "base", sourceKey: "a", explicit: true });

  const unmapped = responses.get("unmapped-rejection");
  expect(unmapped).toBeDefined();
  expect(
    mapDiagnosticToAssignment(
      makePreview(unmapped!),
      unmapped!.diagnostics![0],
      profile,
    ),
  ).toBeNull();

  const blocked = responses.get("blocked-preview");
  expect(blocked).toBeDefined();
  expect(
    mapDiagnosticToAssignment(
      makePreview(blocked!),
      blocked!.diagnostics![0],
      profile,
    ),
  ).toBeNull();
});

test("discards previews from older environment and draft generations", async ({
  page,
}) => {
  const initialWorkspace: ManagerWorkspace = structuredClone(workspace);
  initialWorkspace.snapshot!.configurations = [];
  await page.addInitScript((initial) => {
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    let currentWorkspace = clone(initial);
    let draft: Profile | undefined;
    let receiveWorkspace: ((value: unknown) => void) | undefined;
    const pending: Array<(stateRevision: number) => void> = [];
    const makePreview = (
      candidate: Profile,
      stateRevision: number,
    ): ProfilePreview => {
      const digest = `sha256:${candidate.draft_revision
        .toString(16)
        .padStart(64, "0")}`;
      return {
        profile_id: candidate.id,
        draft_revision: candidate.draft_revision,
        device_id: candidate.device_id,
        manager_server_id: "server-1",
        state_revision: stateRevision,
        candidate_digest: digest,
        validation: {
          outcome: "valid",
          reason_code: "validation_succeeded",
          reason: "Valid",
          candidate_digest: digest,
          diagnostics: [],
        },
        source_map: [],
      };
    };
    window.runtime = {
      EventsOn: (_, callback) => {
        receiveWorkspace = callback;
        return () => {
          receiveWorkspace = undefined;
        };
      },
    };
    (window as any).__previewHarness = {
      count: () => pending.length,
      resolve: (index: number, stateRevision: number) =>
        pending[index]?.(stateRevision),
      publishRevision: (stateRevision: number) => {
        currentWorkspace.snapshot!.state_revision = stateRevision;
        currentWorkspace.snapshot!.event_cursor.state_revision = stateRevision;
        receiveWorkspace?.(clone(currentWorkspace));
      },
      publishCapabilityChange: () => {
        const capability = currentWorkspace.status.capabilities!.find(
          (item) => item.name === "candidate_validation",
        )!;
        capability.reason = "Validation capability was refreshed.";
        receiveWorkspace?.(clone(currentWorkspace));
      },
      currentDraft: () => clone(draft),
    };
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => clone(currentWorkspace),
          Profiles: async () => (draft ? [clone(draft)] : []),
          SelectedProfiles: async () =>
            draft ? { [draft.device_id]: draft.id } : {},
          Geometries: async () => [
            {
              id: "race-layout",
              name: "Race layout",
              description: "Preview race fixture",
              keys: [
                {
                  id: "caps",
                  label: "Caps",
                  source_key: "caps",
                  row: 0,
                  width: 1,
                },
                { id: "a", label: "A", source_key: "a", row: 0, width: 1 },
                { id: "z", label: "Z", source_key: "z", row: 0, width: 1 },
              ],
            },
          ],
          CreateProfile: async (deviceID, name, geometryID) => {
            draft = {
              id: "race-profile",
              name,
              device_id: deviceID,
              draft_revision: 1,
              geometry: { id: geometryID, source_keys: ["caps", "a", "z"] },
              layers: [{ id: "base", name: "Base" }],
              assignments: null,
              settings: { version: 1 },
              created_at: "2026-09-24T10:00:00Z",
              updated_at: "2026-09-24T10:00:00Z",
            };
            return clone(draft);
          },
          SaveProfile: async (value) => {
            if (!draft) throw new Error("race profile is missing");
            draft = {
              ...clone(value),
              draft_revision: draft.draft_revision + 1,
              updated_at: new Date().toISOString(),
            };
            return clone(draft);
          },
          PreviewProfile: async () => {
            if (!draft) throw new Error("race profile is missing");
            const submitted = clone(draft);
            return await new Promise<ProfilePreview>((resolve) => {
              pending.push((stateRevision) =>
                resolve(makePreview(submitted, stateRevision)),
              );
            });
          },
        },
      },
    };
  }, initialWorkspace);

  await page.goto("/");
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const callCount = () =>
    page.evaluate(() => (window as any).__previewHarness.count());
  const resolvePreview = (index: number, revision: number) =>
    page.evaluate(
      ({ previewIndex, stateRevision }) =>
        (window as any).__previewHarness.resolve(previewIndex, stateRevision),
      { previewIndex: index, stateRevision: revision },
    );
  const indicator = page.locator(".configuration-indicator");
  await expect.poll(callCount).toBe(1);

  // The first response claims it observed the new manager revision. The UI
  // must still discard it because a manager snapshot changed while it ran.
  await page.evaluate(() =>
    (window as any).__previewHarness.publishRevision(2),
  );
  await expect(indicator).toHaveAttribute("data-state", "checking");
  await resolvePreview(0, 2);
  await expect.poll(callCount).toBe(2);
  await expect(indicator).toHaveAttribute("data-state", "checking");

  // Capability changes also create a new environment generation without
  // requiring the snapshot's state revision to change.
  await page.evaluate(() =>
    (window as any).__previewHarness.publishCapabilityChange(),
  );
  await resolvePreview(1, 2);
  await expect.poll(callCount).toBe(3);
  await expect(indicator).toHaveAttribute("data-state", "checking");
  await resolvePreview(2, 2);
  await expect(indicator).toHaveAttribute("data-state", "valid");

  // Two quick edits while one request is active keep only the newest candidate.
  await page.locator('.editor-key[data-source-key="caps"]').click();
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await expect(
    page.locator('.editor-key[data-source-key="caps"] small'),
  ).toHaveText("a");
  await expect.poll(callCount).toBe(4);
  await page.locator('.editor-key[data-source-key="z"]').click();
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await expect(
    page.locator('.editor-key[data-source-key="z"] small'),
  ).toHaveText("a");
  await resolvePreview(3, 2);
  await expect.poll(callCount).toBe(5);
  await expect(indicator).toHaveAttribute("data-state", "checking");
  await resolvePreview(4, 2);
  await expect(indicator).toHaveAttribute("data-state", "valid");
  const currentDraft = await page.evaluate(() =>
    (window as any).__previewHarness.currentDraft(),
  );
  expect(currentDraft.draft_revision).toBe(3);
  expect(currentDraft.assignments).toContainEqual({
    layer_id: "base",
    source_key: "caps",
    behavior: { kind: "key", key: "a" },
  });
  expect(currentDraft.assignments).toContainEqual({
    layer_id: "base",
    source_key: "z",
    behavior: { kind: "key", key: "a" },
  });
});

test("revalidates the same draft after reconnect with an unchanged snapshot", async ({
  page,
}) => {
  const initialWorkspace: ManagerWorkspace = structuredClone(workspace);
  initialWorkspace.snapshot!.configurations = [];
  const savedDraft: Profile = {
    id: "reconnect-profile",
    name: "Reconnect draft",
    device_id: "device-1",
    draft_revision: 1,
    geometry: { id: "reconnect-layout", source_keys: ["caps"] },
    layers: [{ id: "base", name: "Base" }],
    assignments: null,
    settings: { version: 1 },
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
  };
  await page.addInitScript(
    ({ initial, profile }) => {
      const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
      let currentWorkspace = clone(initial);
      let receiveWorkspace: ((value: unknown) => void) | undefined;
      const pending: Array<(stateRevision: number) => void> = [];
      const makePreview = (stateRevision: number): ProfilePreview => {
        const candidateDigest = `sha256:${"d".repeat(64)}`;
        return {
          profile_id: profile.id,
          draft_revision: profile.draft_revision,
          device_id: profile.device_id,
          manager_server_id: "server-1",
          state_revision: stateRevision,
          candidate_digest: candidateDigest,
          validation: {
            outcome: "valid",
            reason_code: "validation_succeeded",
            reason: "Valid",
            candidate_digest: candidateDigest,
            diagnostics: [],
          },
          source_map: [],
        };
      };
      window.runtime = {
        EventsOn: (_, callback) => {
          receiveWorkspace = callback;
          return () => {
            receiveWorkspace = undefined;
          };
        },
      };
      (window as any).__reconnectHarness = {
        count: () => pending.length,
        resolve: (index: number, revision: number) =>
          pending[index]?.(revision),
        disconnect: () => {
          currentWorkspace.status = {
            ...currentWorkspace.status,
            state: "unavailable",
            message: "The manager connection was interrupted.",
          };
          currentWorkspace.stale = true;
          receiveWorkspace?.(clone(currentWorkspace));
        },
        reconnect: () => {
          currentWorkspace.status = {
            ...currentWorkspace.status,
            state: "ready",
            message: "Manager capabilities are available.",
          };
          currentWorkspace.stale = false;
          receiveWorkspace?.(clone(currentWorkspace));
        },
      };
      window.go = {
        main: {
          App: {
            Info: async () => ({ name: "KeyboarDeer", version: "test" }),
            Workspace: async () => clone(currentWorkspace),
            Profiles: async () => [clone(profile)],
            SelectedProfiles: async () => ({ [profile.device_id]: profile.id }),
            Geometries: async () => [
              {
                id: "reconnect-layout",
                name: "Reconnect layout",
                description: "Reconnect preview fixture",
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
            PreviewProfile: async () =>
              await new Promise<ProfilePreview>((resolve) => {
                pending.push((revision) => resolve(makePreview(revision)));
              }),
          },
        },
      };
    },
    { initial: initialWorkspace, profile: savedDraft },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  const callCount = () =>
    page.evaluate(() => (window as any).__reconnectHarness.count());
  const resolvePreview = (index: number) =>
    page.evaluate((previewIndex) => {
      (window as any).__reconnectHarness.resolve(previewIndex, 1);
    }, index);
  const indicator = page.locator(".configuration-indicator");
  await expect.poll(callCount).toBe(1);
  await page.evaluate(() => (window as any).__reconnectHarness.disconnect());
  await expect(indicator).toHaveAttribute("data-state", "unchecked");
  await resolvePreview(0);
  await expect(indicator).toHaveAttribute("data-state", "unchecked");
  await expect.poll(callCount).toBe(1);

  await page.evaluate(() => (window as any).__reconnectHarness.reconnect());
  await expect(indicator).toHaveAttribute("data-state", "checking");
  await expect.poll(callCount).toBe(2);
  await resolvePreview(1);
  await expect(indicator).toHaveAttribute("data-state", "valid");
});

test("does not let an in-flight preview paint a newly selected profile", async ({
  page,
}) => {
  const switchingWorkspace: ManagerWorkspace = structuredClone(workspace);
  switchingWorkspace.snapshot!.configurations = [];
  switchingWorkspace.snapshot!.devices = [
    {
      ...workspace.snapshot!.devices![0],
      id: "device-1",
      display_name: "Keyboard One",
    },
    {
      ...workspace.snapshot!.devices![0],
      id: "device-2",
      display_name: "Keyboard Two",
    },
  ];
  const profiles: Profile[] = ["device-1", "device-2"].map(
    (deviceID, index) => ({
      id: `switch-profile-${index + 1}`,
      name: `Keyboard ${index + 1} profile`,
      device_id: deviceID,
      draft_revision: 1,
      geometry: { id: "switch-layout", source_keys: ["a"] },
      layers: [{ id: "base", name: "Base" }],
      assignments: null,
      settings: { version: 1 },
      created_at: `2026-09-24T10:00:0${index}Z`,
      updated_at: "2026-09-24T10:00:00Z",
    }),
  );
  await page.addInitScript(
    ({ initial, savedProfiles }) => {
      const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
      let receiveWorkspace: ((value: unknown) => void) | undefined;
      const pending: Array<(stateRevision: number) => void> = [];
      window.runtime = {
        EventsOn: (_, callback) => {
          receiveWorkspace = callback;
          return () => {
            receiveWorkspace = undefined;
          };
        },
      };
      (window as any).__switchHarness = {
        count: () => pending.length,
        resolve: (index: number, revision: number) =>
          pending[index]?.(revision),
      };
      window.go = {
        main: {
          App: {
            Info: async () => ({ name: "KeyboarDeer", version: "test" }),
            Workspace: async () => clone(initial),
            Profiles: async () => clone(savedProfiles),
            SelectedProfiles: async () => ({
              "device-1": savedProfiles[0].id,
              "device-2": savedProfiles[1].id,
            }),
            Geometries: async () => [
              {
                id: "switch-layout",
                name: "Switch layout",
                description: "Profile-switch preview fixture",
                keys: [
                  { id: "a", label: "A", source_key: "a", row: 0, width: 1 },
                ],
              },
            ],
            SelectProfile: async () => undefined,
            PreviewProfile: async (id) => {
              const selected = clone(
                savedProfiles.find((item) => item.id === id)!,
              );
              return await new Promise<ProfilePreview>((resolve) => {
                pending.push((revision) => {
                  const digest = `sha256:${"e".repeat(64)}`;
                  resolve({
                    profile_id: selected.id,
                    draft_revision: selected.draft_revision,
                    device_id: selected.device_id,
                    manager_server_id: "server-1",
                    state_revision: revision,
                    candidate_digest: digest,
                    validation: {
                      outcome: "valid",
                      reason_code: "validation_succeeded",
                      reason: "Valid",
                      candidate_digest: digest,
                      diagnostics: [],
                    },
                    source_map: [],
                  });
                });
              });
            },
          },
        },
      };
    },
    { initial: switchingWorkspace, savedProfiles: profiles },
  );

  await page.goto("/");
  const firstCard = page
    .locator(".device-card")
    .filter({ hasText: "Keyboard One" });
  await firstCard
    .getByRole("button", { name: "Edit draft", exact: true })
    .click();
  const callCount = () =>
    page.evaluate(() => (window as any).__switchHarness.count());
  await expect.poll(callCount).toBe(1);
  await page.getByRole("button", { name: "← All keyboards" }).click();
  const secondCard = page
    .locator(".device-card")
    .filter({ hasText: "Keyboard Two" });
  await secondCard
    .getByRole("button", { name: "Edit draft", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Keyboard 2 profile" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__switchHarness.resolve(0, 1));
  await expect.poll(callCount).toBe(2);
  await expect(page.locator(".configuration-indicator")).toHaveAttribute(
    "data-state",
    "checking",
  );
  await page.evaluate(() => (window as any).__switchHarness.resolve(1, 1));
  await expect(page.locator(".configuration-indicator")).toHaveAttribute(
    "data-state",
    "valid",
  );
});

test("partially recovers multiple diagnostics across layers", async ({
  page,
}) => {
  const state: ManagerWorkspace = structuredClone(workspace);
  state.snapshot!.configurations = [];
  await page.addInitScript((fixture) => {
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    const now = "2026-09-24T10:00:00Z";
    let draft: Profile | undefined;
    const sourceMap = [
      {
        layer_id: "base",
        source_key: "caps",
        explicit: true,
        span: { start_line: 4, start_column: 3, end_line: 4, end_column: 8 },
      },
      {
        layer_id: "navigation",
        source_key: "z",
        explicit: true,
        span: { start_line: 9, start_column: 3, end_line: 9, end_column: 8 },
      },
    ];
    const validPreview = (): ProfilePreview => {
      if (!draft) throw new Error("multi-issue profile is missing");
      const candidateDigest = `sha256:${draft.draft_revision
        .toString(16)
        .padStart(64, "0")}`;
      const validationRecovery = {
        checkpoint: {
          draft_revision: draft.draft_revision,
          manager_server_id: "server-1",
          candidate_digest: candidateDigest,
          geometry: clone(draft.geometry),
          layers: clone(draft.layers),
          assignments: clone(draft.assignments),
          aliases: draft.aliases,
          macros: draft.macros,
        },
        pre_edit: [],
      };
      return {
        profile_id: draft.id,
        draft_revision: draft.draft_revision,
        device_id: draft.device_id,
        manager_server_id: "server-1",
        state_revision: 1,
        candidate_digest: candidateDigest,
        validation_recovery: validationRecovery,
        validation: {
          outcome: "valid",
          reason_code: "validation_succeeded",
          reason: "The whole draft is valid.",
          candidate_digest: candidateDigest,
          diagnostics: [],
        },
        source_map: sourceMap,
      };
    };
    const rejectedPreview = (
      badCaps: boolean,
      badNavigation: boolean,
    ): ProfilePreview => {
      if (!draft) throw new Error("multi-issue profile is missing");
      const candidateDigest = `sha256:${"f".repeat(64)}`;
      const diagnostics = [];
      if (badCaps) {
        diagnostics.push({
          id: "bad-base-caps",
          severity: "error",
          reason_code: "validation_failed",
          summary: "Base Caps is invalid.",
          remediation: "Restore the last validated assignment.",
          location: {
            scope: "submitted_behavior",
            start_line: 4,
            start_column: 3,
            end_line: 4,
            end_column: 4,
          },
        });
      }
      if (badNavigation) {
        diagnostics.push({
          id: "bad-navigation-z",
          severity: "error",
          reason_code: "validation_failed",
          summary: "Navigation Z is invalid.",
          remediation: "Restore the last validated assignment.",
          location: {
            scope: "submitted_behavior",
            start_line: 9,
            start_column: 3,
            end_line: 9,
            end_column: 4,
          },
        });
      }
      return {
        profile_id: draft.id,
        draft_revision: draft.draft_revision,
        device_id: draft.device_id,
        manager_server_id: "server-1",
        state_revision: 1,
        candidate_digest: candidateDigest,
        validation: {
          outcome: "rejected",
          reason_code: "validation_failed",
          reason: "Two assignments need attention.",
          candidate_digest: candidateDigest,
          diagnostics,
        },
        source_map: sourceMap,
      };
    };
    (window as any).__multiRecoveryDraft = () => clone(draft);
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => fixture,
          Profiles: async () => (draft ? [clone(draft)] : []),
          SelectedProfiles: async () =>
            draft ? { [draft.device_id]: draft.id } : {},
          Geometries: async () => [
            {
              id: "multi-layout",
              name: "Multi-layer layout",
              description: "Cross-layer recovery fixture",
              keys: [
                {
                  id: "caps",
                  label: "Caps",
                  source_key: "caps",
                  row: 0,
                  width: 1,
                },
                { id: "a", label: "A", source_key: "a", row: 0, width: 1 },
                { id: "z", label: "Z", source_key: "z", row: 0, width: 1 },
              ],
            },
          ],
          CreateProfile: async (deviceID, name, geometryID) => {
            draft = {
              id: "multi-profile",
              name,
              device_id: deviceID,
              draft_revision: 1,
              geometry: { id: geometryID, source_keys: ["caps", "a", "z"] },
              layers: [
                { id: "base", name: "Base" },
                { id: "navigation", name: "Navigation" },
              ],
              assignments: [
                {
                  layer_id: "base",
                  source_key: "caps",
                  behavior: { kind: "key", key: "esc" },
                },
                {
                  layer_id: "base",
                  source_key: "a",
                  behavior: { kind: "key", key: "b" },
                },
                {
                  layer_id: "navigation",
                  source_key: "z",
                  behavior: { kind: "key", key: "d" },
                },
              ],
              settings: { version: 1 },
              created_at: now,
              updated_at: now,
            };
            return clone(draft);
          },
          SaveProfile: async (value) => {
            if (!draft) throw new Error("multi-issue profile is missing");
            draft = {
              ...clone(value),
              draft_revision: draft.draft_revision + 1,
              updated_at: new Date().toISOString(),
            };
            return clone(draft);
          },
          PreviewProfile: async () => {
            if (!draft) throw new Error("multi-issue profile is missing");
            const badCaps = draft.assignments?.some(
              (assignment) =>
                assignment.layer_id === "base" &&
                assignment.source_key === "caps" &&
                assignment.behavior.key === "a",
            );
            const badNavigation = draft.assignments?.some(
              (assignment) =>
                assignment.layer_id === "navigation" &&
                assignment.source_key === "z" &&
                assignment.behavior.key === "a",
            );
            return badCaps || badNavigation
              ? rejectedPreview(!!badCaps, !!badNavigation)
              : validPreview();
          },
        },
      },
    };
  }, state);

  await page.goto("/");
  await expect(page.getByText("Manager ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.locator(".configuration-indicator")).toHaveAttribute(
    "data-state",
    "valid",
  );
  const layerTabs = page.getByRole("tablist", { name: "Keymap layers" });
  await layerTabs.getByRole("tab", { name: "Base" }).click();
  await page.locator('.editor-key[data-source-key="caps"]').click();
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await layerTabs.getByRole("tab", { name: "Navigation" }).click();
  await page.locator('.editor-key[data-source-key="z"]').click();
  await page.locator('.palette-key[aria-label="Assign A (a)"]').click();
  await expect(page.locator(".validation-diagnostics li")).toHaveCount(2);
  await page.getByRole("button", { name: "Show Base · caps" }).click();
  await expect(page.locator('.editor-key[data-source-key="caps"]')).toHaveClass(
    /invalid-key/,
  );
  await page.getByRole("button", { name: "Show Navigation · z" }).click();
  await expect(page.locator('.editor-key[data-source-key="z"]')).toBeFocused();
  await page.getByRole("button", { name: "Revert z" }).click();
  await expect(page.locator(".validation-diagnostics li")).toHaveCount(1);
  await expect(
    page.locator('.editor-key[data-source-key="z"] small'),
  ).toHaveText("d");
  await page.getByRole("button", { name: "Show Base · caps" }).click();
  await expect(
    page.locator('.editor-key[data-source-key="caps"] small'),
  ).toHaveText("a");
  const afterFirstRecovery = await page.evaluate(() =>
    (window as any).__multiRecoveryDraft(),
  );
  expect(afterFirstRecovery.assignments).toContainEqual({
    layer_id: "navigation",
    source_key: "z",
    behavior: { kind: "key", key: "d" },
  });
  expect(
    afterFirstRecovery.validation_recovery.checkpoint.assignments,
  ).toContainEqual({
    layer_id: "navigation",
    source_key: "z",
    behavior: { kind: "key", key: "d" },
  });
  await page.getByRole("button", { name: "Revert caps" }).click();
  await expect(page.locator(".configuration-indicator")).toHaveAttribute(
    "data-state",
    "valid",
  );
  await expect(
    page.locator('.editor-key[data-source-key="caps"] small'),
  ).toHaveText("esc");
  const afterSecondRecovery = await page.evaluate(() =>
    (window as any).__multiRecoveryDraft(),
  );
  expect(afterSecondRecovery.assignments).toContainEqual({
    layer_id: "navigation",
    source_key: "z",
    behavior: { kind: "key", key: "d" },
  });
  await layerTabs.getByRole("tab", { name: "Navigation" }).click();
  await expect(
    page.locator('.editor-key[data-source-key="z"] small'),
  ).toHaveText("d");
});

test("switches, renames, duplicates, and deletes profiles per keyboard", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((fixture) => {
    const now = "2026-09-24T08:00:00Z";
    let profiles: Profile[] = [
      {
        id: "profile-typing",
        name: "Typing",
        device_id: "device-1",
        draft_revision: 1,
        geometry: { id: "fixture", source_keys: ["caps", "a"] },
        layers: [{ id: "base", name: "Base" }],
        assignments: null,
        settings: { version: 1 },
        created_at: now,
        updated_at: now,
      },
    ];
    let selected: Record<string, string> = { "device-1": "profile-typing" };
    let created = 0;
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => fixture,
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
                { id: "a", label: "A", source_key: "a", row: 0, width: 1 },
              ],
            },
          ],
          Profiles: async () => clone(profiles),
          SelectedProfiles: async () => clone(selected),
          SelectProfile: async (deviceID, profileID) => {
            selected[deviceID] = profileID;
          },
          SaveProfile: async (value) => {
            const saved = {
              ...clone(value),
              draft_revision: value.draft_revision + 1,
            };
            profiles = profiles.map((item) =>
              item.id === saved.id ? saved : item,
            );
            return clone(saved);
          },
          DuplicateProfile: async (id, name) => {
            const source = profiles.find((item) => item.id === id)!;
            created += 1;
            const copy = {
              ...clone(source),
              id: `profile-copy-${created}`,
              name,
              draft_revision: 1,
              manager_configuration_id: undefined,
              created_at: `2026-09-24T09:0${created}:00Z`,
            };
            profiles = [...profiles, copy];
            selected[copy.device_id] = copy.id;
            return clone(copy);
          },
          DeleteProfile: async (id) => {
            const deleted = profiles.find((item) => item.id === id)!;
            profiles = profiles.filter((item) => item.id !== id);
            const sibling = profiles.find(
              (item) => item.device_id === deleted.device_id,
            );
            if (sibling) selected[deleted.device_id] = sibling.id;
            else delete selected[deleted.device_id];
          },
          PreviewProfile: async (id) => ({
            profile_id: id,
            draft_revision: profiles.find((item) => item.id === id)!
              .draft_revision,
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
        },
      },
    };
  }, workspace);
  await page.goto("/");
  await expect(
    page.getByText("Profile: Typing", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Typing", level: 1 }),
  ).toBeVisible();
  const capsBehavior = page.locator(".editor-key").first().locator("small");

  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Typing copy", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Rename this profile").fill("Gaming");
  await page.getByRole("button", { name: "Rename profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Gaming", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close profiles" }).click();
  await expect(
    page.getByRole("button", { name: "Profiles (2)", exact: true }),
  ).toBeVisible();

  await page.locator(".editor-key").first().click();
  await page.getByRole("button", { name: "Disable selected key" }).click();
  await expect(capsBehavior).toHaveText("No output");

  await page.getByRole("button", { name: "Profiles (2)", exact: true }).click();
  await page.getByRole("button", { name: "Open Typing" }).click();
  await expect(
    page.getByRole("heading", { name: "Typing", level: 1 }),
  ).toBeVisible();
  await expect(capsBehavior).toHaveText("caps");
  await page.getByRole("button", { name: "Open Gaming" }).click();
  await expect(capsBehavior).toHaveText("No output");

  await page.getByRole("button", { name: "Delete profile" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This draft has not been applied.",
  );
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(
    page.getByRole("heading", { name: "Typing", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close profiles" }).click();
  await page.getByRole("button", { name: "← All keyboards" }).click();
  await expect(
    page.getByText("Profile: Typing", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("re-reviews a stale apply and safely rechecks an unconfirmed one", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((fixture) => {
    const state = JSON.parse(JSON.stringify(fixture)) as ManagerWorkspace;
    let draft: Profile = {
      id: "profile-1",
      name: "Typing",
      device_id: "device-1",
      draft_revision: 3,
      geometry: { id: "fixture", source_keys: ["caps"] },
      layers: [{ id: "base", name: "Base" }],
      assignments: null,
      settings: { version: 1 },
      created_at: "2026-09-24T08:00:00Z",
      updated_at: "2026-09-24T08:00:00Z",
    };
    let applyCalls = 0;
    let resumeCalls = 0;
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => JSON.parse(JSON.stringify(state)),
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
          Profiles: async () => [draft],
          PreviewProfile: async (id) => ({
            profile_id: id,
            draft_revision: draft.draft_revision,
            device_id: "device-1",
            manager_server_id: "server-1",
            state_revision: state.snapshot!.state_revision,
            validation: {
              outcome: "valid",
              reason_code: "validation_succeeded",
              reason: "Valid",
              diagnostics: null,
            },
            source_map: [],
          }),
          ApplyProfile: async () => {
            applyCalls += 1;
            if (applyCalls === 1) {
              // Another client changed the configuration after review.
              state.snapshot!.state_revision += 1;
              return {
                profile: draft,
                operation: {
                  id: "",
                  kind: "",
                  state: "",
                  reason_code: "",
                  reason: "",
                },
                stale: true,
              };
            }
            draft = {
              ...draft,
              apply_pending: {
                manager_server_id: "server-1",
                started_at: "2026-09-24T09:00:00Z",
                idempotency_key: "keyboardeer-abc",
                idempotency_supported: true,
                method: "configuration.update",
              },
            };
            return {
              profile: draft,
              operation: {
                id: "",
                kind: "",
                state: "",
                reason_code: "",
                reason: "",
              },
              uncertain: true,
            };
          },
          ResumeApply: async () => {
            resumeCalls += 1;
            if (resumeCalls === 1) {
              // Reconnect recovery can find the request still unresolved;
              // leave it available for the explicit manual check.
              return {
                profile: draft,
                operation: {
                  id: "",
                  kind: "",
                  state: "",
                  reason_code: "",
                  reason: "",
                },
                uncertain: true,
              };
            }
            draft = {
              ...draft,
              apply_pending: null,
              manager_configuration_id: "cfg-1",
            };
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
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  const apply = page.locator(".editor-apply");
  await expect(apply).toBeEnabled();
  await apply.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Apply to keyboard" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "changed on the manager since you reviewed it",
  );
  await expect(
    dialog.getByRole("button", { name: "Apply to keyboard" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply to keyboard" }).click();
  await expect(page.locator(".apply-pending")).toContainText(
    "KeyboarDeer kept the exact request",
  );
  await expect(apply).toBeDisabled();
  await page.getByRole("button", { name: "Check apply outcome" }).click();
  await expect(
    page.getByText(
      "Manager Apply: Succeeded — configuration persisted and activation confirmed",
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("restores apply outcome and manager-reported active revision after restart", async ({
  page,
}) => {
  await page.addInitScript((fixture) => {
    const state = JSON.parse(JSON.stringify(fixture)) as ManagerWorkspace;
    state.snapshot!.configurations![0].desired_revision = 8;
    state.snapshot!.configurations![0].active_revision = 7;
    const draft: Profile = {
      id: "profile-rolled-back",
      name: "Typing",
      device_id: "device-1",
      manager_configuration_id: "cfg-1",
      draft_revision: 4,
      geometry: { id: "fixture", source_keys: ["caps"] },
      layers: [{ id: "base", name: "Base" }],
      assignments: null,
      settings: { version: 1 },
      created_at: "2026-09-24T08:00:00Z",
      updated_at: "2026-09-24T08:00:00Z",
      last_apply_operation: {
        id: "op-rolled-back",
        kind: "apply",
        state: "rolled_back",
        resource: { kind: "configuration", id: "cfg-1" },
        reason_code: "runtime_rollback_succeeded",
        reason: "activation failed; the previous revision was restored",
        configuration_revision: 8,
      },
    };
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => JSON.parse(JSON.stringify(state)),
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
          Profiles: async () => [draft],
          PreviewProfile: async (id) => ({
            profile_id: id,
            draft_revision: draft.draft_revision,
            device_id: draft.device_id,
            manager_server_id: state.status.server_id!,
            state_revision: state.snapshot!.state_revision,
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
  }, workspace);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await expect(page.locator(".apply-outcome")).toContainText(
    "Manager Apply: Rolled Back",
  );
  await expect(page.locator(".apply-outcome")).toContainText(
    "manager restored the previous mapping",
  );
  await expect(page.locator(".active-revision")).toContainText(
    "Manager-reported active revision: 7 · desired revision 8 · runtime: healthy.",
  );
});

test("requires manual resolution when manager idempotency is unknown", async ({
  page,
}) => {
  await page.addInitScript((fixture) => {
    const state = JSON.parse(JSON.stringify(fixture)) as ManagerWorkspace;
    let draft: Profile = {
      id: "profile-uncertain-legacy",
      name: "Typing",
      device_id: "device-1",
      draft_revision: 2,
      geometry: { id: "fixture", source_keys: ["caps"] },
      layers: [{ id: "base", name: "Base" }],
      assignments: null,
      settings: { version: 1 },
      created_at: "2026-09-24T08:00:00Z",
      updated_at: "2026-09-24T08:00:00Z",
      apply_pending: {
        manager_server_id: "server-1",
        started_at: "2026-09-24T09:00:00Z",
        idempotency_key: "keyboardeer-legacy",
        idempotency_supported: false,
        method: "configuration.create",
      },
    };
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => JSON.parse(JSON.stringify(state)),
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
          Profiles: async () => [draft],
          DiscardPendingApply: async () => {
            draft = {
              ...draft,
              apply_pending: null,
              last_apply_operation: {
                id: "",
                kind: "apply",
                state: "unknown",
                reason_code: "apply_outcome_unknown",
                reason:
                  "The outcome was not confirmed; the pending request was cleared without replay.",
              },
            };
            return draft;
          },
        },
      },
    };
  }, workspace);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await expect(page.locator(".apply-status")).toContainText(
    "does not guarantee durable idempotency",
  );
  await expect(
    page.getByRole("button", { name: "Check apply outcome" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "I checked the keyboard — continue editing" })
    .click();
  await expect(page.locator(".apply-outcome")).toContainText(
    "Manager Apply: Unknown",
  );
  await expect(page.locator(".apply-outcome")).toContainText(
    "cleared without replay",
  );
});

test("removes a managed mapping from the keyboard with confirmation", async ({
  page,
}) => {
  await page.addInitScript((fixture) => {
    const state = JSON.parse(JSON.stringify(fixture)) as ManagerWorkspace;
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => state,
          Geometries: async () => [],
          Profiles: async () => [],
          DeleteConfiguration: async (id) => {
            state.snapshot!.configurations =
              state.snapshot!.configurations!.filter(
                (configuration) => configuration.id !== id,
              );
            state.snapshot!.state_revision += 1;
            return {
              id: "op-delete",
              kind: "lifecycle",
              state: "succeeded",
              resource: { kind: "configuration", id },
              reason_code: "operation_succeeded",
              reason: "configuration deleted and its KMonad process stopped",
            };
          },
        },
      },
    };
  }, workspace);
  await page.goto("/");
  await expect(page.locator(".configuration-state")).toContainText(
    "Managed fixture",
  );
  await page.getByRole("button", { name: "Remove from keyboard" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your KeyboarDeer profiles are kept",
  );
  await page.getByRole("button", { name: "Keep mapping" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove from keyboard" }).click();
  await page
    .getByRole("button", { name: "Confirm: remove from keyboard" })
    .click();
  await expect(page.locator(".configuration-state")).toHaveCount(0);
  await expect(
    page.getByText(/Removed “Managed fixture” from the keyboard/),
  ).toBeVisible();
});

test("offers backup-and-reset recovery for a damaged draft file", async ({
  page,
}) => {
  await page.addInitScript((fixture) => {
    let corrupt = true;
    window.go = {
      main: {
        App: {
          Info: async () => ({ name: "KeyboarDeer", version: "test" }),
          Workspace: async () => fixture,
          Geometries: async () => [],
          Profiles: async () => {
            if (corrupt) throw new Error("profile store is corrupt");
            return [];
          },
          ProfileStoreStatus: async () =>
            corrupt
              ? {
                  state: "corrupt",
                  message:
                    "Saved keyboard drafts could not be read. The file may be damaged.",
                  path: "/home/user/.config/keyboardeer/profiles.json",
                }
              : { state: "ok", message: "" },
          RecoverCorruptProfileStore: async () => {
            corrupt = false;
            return "/home/user/.config/keyboardeer/profiles.json.corrupt-1";
          },
        },
      },
    };
  }, workspace);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Saved drafts could not be loaded" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up" })).toBeDisabled();
  await page.getByRole("button", { name: "Back up and start fresh" }).click();
  await page
    .getByRole("button", { name: "Confirm: back up and start fresh" })
    .click();
  await expect(
    page.getByText(/profiles\.json\.corrupt-1\. KeyboarDeer started a new/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saved drafts could not be loaded" }),
  ).toHaveCount(0);
});

test("keeps the last snapshot visibly stale when the manager disconnects", async ({
  page,
}) => {
  const staleWorkspace: ManagerWorkspace = structuredClone(workspace);
  staleWorkspace.status = {
    state: "unavailable",
    message: "The manager socket could not be reached.",
    endpoint: workspace.status.endpoint,
    server_id: "server-1",
    capabilities: workspace.status.capabilities,
  };
  staleWorkspace.stale = true;
  staleWorkspace.snapshot_at = "2026-09-24T12:00:00Z";
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
  }, staleWorkspace);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Keyboard status may be out of date" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Unconfigured keyboard" }),
  ).toBeVisible();
  await expect(page.getByText("1 known", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up" })).toBeDisabled();
  await expect(page.getByLabel("Identify")).toBeDisabled();
});

test("explains unavailable and conflicting keyboard states", async ({
  page,
}) => {
  const stateWorkspace: ManagerWorkspace = structuredClone(workspace);
  stateWorkspace.snapshot!.devices = [
    {
      ...workspace.snapshot!.devices![0],
      id: "disconnected",
      display_name: "Disconnected keyboard",
      availability: "disconnected",
    },
    {
      ...workspace.snapshot!.devices![0],
      id: "inaccessible",
      display_name: "Permission-limited keyboard",
      availability: "inaccessible",
    },
    {
      ...workspace.snapshot!.devices![0],
      id: "unsupported",
      display_name: "Unsupported keyboard",
      availability: "unsupported",
    },
    {
      ...workspace.snapshot!.devices![0],
      id: "conflicting",
      display_name: "Conflicting keyboard",
      runtime_conflict: true,
    },
  ];
  stateWorkspace.snapshot!.configurations = [
    ...(stateWorkspace.snapshot!.configurations ?? []),
    {
      id: "external-1",
      name: "Existing remap",
      ownership: "external",
      enabled: true,
      device_id: "",
      desired_revision: 0,
      active_revision: 0,
      runtime: {
        phase: "failed",
        reason_code: "runtime_failed",
        reason: "The manager could not start this external mapping.",
        connected: false,
        healthy: false,
        failure_count: 1,
      },
      last_operation: {
        id: "op-external-1",
        kind: "reconcile",
        state: "failed",
        reason_code: "runtime_failed",
        reason: "Review the manager diagnostic before changing this mapping.",
      },
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
  }, stateWorkspace);
  await page.goto("/");
  await expect(
    page.getByText("Reconnect this keyboard to configure or identify it."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The manager cannot access this keyboard. Check its input-access permissions.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The manager does not support this keyboard on the current backend.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Another configuration or mapping conflicts with this keyboard.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "External configurations" }),
  ).toBeVisible();
  await expect(page.getByText("MANAGER-OWNED", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The manager could not start this external mapping."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Latest manager operation: Failed — Review the manager diagnostic before changing this mapping.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View external configuration details" })
    .click();
  await expect(
    page.getByRole("heading", { name: "External configurations" }),
  ).toHaveCount(2);
  await expect(
    page.getByText("Raw KMonad source is unavailable", { exact: true }),
  ).toBeVisible();
});

test("supports keyboard navigation, dialog focus trapping, and focus restoration", async ({
  page,
}) => {
  await page.addInitScript((fixture) => {
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
          Workspace: async () => fixture,
          Profiles: async () => (draft ? [draft] : []),
          SelectedProfiles: async () => (draft ? { "device-1": draft.id } : {}),
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
            receiveWorkspace?.(fixture);
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
        },
      },
    };
  }, workspace);
  await page.goto("/");
  await expect(page.getByText("Manager ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.locator(".editor-key")).toHaveCount(5);

  // aria-live context region announces the selected key and active layer.
  const selectedKeyContext = page.locator(".selected-key-context");
  await expect(selectedKeyContext).toHaveAttribute("aria-live", "polite");
  await expect(selectedKeyContext).toHaveAttribute("aria-atomic", "true");
  await expect(selectedKeyContext.locator("strong")).toHaveText("Select a key");
  await page.locator(".editor-key").first().click();
  await expect(selectedKeyContext.locator("strong")).toHaveText("caps");
  await expect(selectedKeyContext.locator("span").first()).toHaveText(
    "Base layer",
  );

  // Tab panels are wired to their tab controls with real ids.
  const layerPanel = page.locator("#keyboard-layer-panel");
  await expect(layerPanel).toHaveAttribute("role", "tabpanel");
  const baseTab = page
    .getByRole("tablist", { name: "Keymap layers" })
    .getByRole("tab", { name: "Base", exact: true });
  await expect(baseTab).toHaveAttribute(
    "aria-controls",
    "keyboard-layer-panel",
  );
  await expect(layerPanel).toHaveAttribute("aria-labelledby", "layer-tab-base");

  // Arrow keys roam the palette category tabs and wrap around.
  const categoryTablist = page.getByRole("tablist", {
    name: "Key categories",
  });
  const allCategory = categoryTablist.getByRole("tab", { name: "All" });
  await allCategory.focus();
  await expect(allCategory).toHaveAttribute("aria-selected", "true");
  await expect(allCategory).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("ArrowRight");
  const numbersCategory = categoryTablist.getByRole("tab", {
    name: "Numbers",
  });
  await expect(numbersCategory).toBeFocused();
  await expect(numbersCategory).toHaveAttribute("aria-selected", "true");
  const palettePanel = page.locator("#palette-category-panel");
  await expect(palettePanel).toHaveAttribute("role", "tabpanel");
  await expect(palettePanel).toHaveAttribute(
    "aria-labelledby",
    "palette-category-0",
  );
  await numbersCategory.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(allCategory).toBeFocused();
  await expect(allCategory).toHaveAttribute("aria-selected", "true");
  await allCategory.focus();
  await page.keyboard.press("ArrowLeft");
  const otherCategory = categoryTablist.getByRole("tab", { name: "Other" });
  await expect(otherCategory).toBeFocused();
  await expect(otherCategory).toHaveAttribute("aria-selected", "true");

  // Managing layers opens a modal dialog that traps focus and inerts the app.
  const manage = page.getByRole("button", { name: "Manage", exact: true });
  await manage.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const closeDialog = dialog.getByRole("button", {
    name: "Close complex action dialog",
  });
  await expect(closeDialog).toBeFocused();
  expect(
    await page.locator(".app-header").evaluate((element) => element.inert),
  ).toBe(true);
  expect(await page.locator("main").evaluate((element) => element.inert)).toBe(
    true,
  );
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => document.activeElement?.closest("dialog") !== null,
      ),
    ).toBe(true);
  }
  await closeDialog.focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () => document.activeElement?.closest("dialog") !== null,
      ),
    ).toBe(true);
  }

  // Add a second layer while the dialog is open; Escape closes and restores
  // focus to the Manage button that opened the dialog.
  await page.getByLabel("Add a layer").fill("Navigation");
  await dialog.getByRole("button", { name: "Add layer" }).click();
  const navigationTab = page
    .getByRole("tablist", { name: "Keymap layers" })
    .getByRole("tab", { name: "Navigation" });
  await expect(navigationTab).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(manage).toBeFocused();

  // Arrow keys roam the layer tabs and update the panel label.
  await baseTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(navigationTab).toBeFocused();
  await expect(navigationTab).toHaveAttribute("aria-selected", "true");
  await expect(baseTab).toHaveAttribute("aria-selected", "false");
  await expect(baseTab).toHaveAttribute("tabindex", "-1");
  await expect(navigationTab).toHaveAttribute("tabindex", "0");
  const navigationTabID = await navigationTab.getAttribute("id");
  await expect(layerPanel).toHaveAttribute("aria-labelledby", navigationTabID!);
  await page.keyboard.press("ArrowLeft");
  await expect(baseTab).toBeFocused();
  await expect(baseTab).toHaveAttribute("aria-selected", "true");

  // Reduced motion collapses the key-flash animation to nearly instant.
  // Deselect any chosen key first: the flash only fires while no source key
  // is actively selected.
  await page.locator(".editor-key").first().click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("CapsLock");
  await expect(page.locator(".editor-key.flashing-key")).toHaveCSS(
    "animation-duration",
    /0\.01ms|1e-05s/,
  );

  // Small windows (the CSS-pixel equivalent of 200% zoom at 1280 wide) switch
  // to the compact palette: the strip and editor heading fit the window with
  // no clipping, key rows and categories stay reachable through their own
  // horizontal scroll, and there is no document-level horizontal overflow.
  await page.setViewportSize({ width: 640, height: 700 });
  const editorPage = page.locator(".editor-page");
  await expect(editorPage).toHaveClass(/compact-palette/);
  const smallPalette = await page.locator(".key-palette").boundingBox();
  expect(smallPalette).not.toBeNull();
  expect(Math.round(smallPalette!.width)).toBe(640);
  const applyButton = page.getByRole("button", { name: "Apply to keyboard" });
  const applyRight = await applyButton.evaluate(
    (element) => element.getBoundingClientRect().right,
  );
  expect(Math.round(applyRight)).toBeLessThanOrEqual(640);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".palette-buttons")).toHaveCSS(
    "overflow-x",
    "auto",
  );
  await expect(page.locator(".palette-categories")).toHaveCSS(
    "overflow-x",
    "auto",
  );
});
