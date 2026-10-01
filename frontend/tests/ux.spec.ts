import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { diffAgainstApplied } from "../src/domain/applyDiff";
import type {
  GeometryTemplate,
  ManagerWorkspace,
  Profile,
  ProfilePreview,
  ScanMatch,
} from "../src/platform/desktop";

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

const validPreview: ProfilePreview["validation"] = {
  outcome: "valid",
  reason_code: "validation_succeeded",
  reason: "Valid",
  diagnostics: null,
};

type Fixture = {
  workspace: ManagerWorkspace;
  geometry: GeometryTemplate;
  profile: Profile;
  validation: ProfilePreview["validation"];
  extraGeometries: GeometryTemplate[];
  /** When set, the desktop offers layout detection with these matches. */
  scanMatches: ScanMatch[] | null;
};

async function openWorkspace(page: Page, fixture: Partial<Fixture> = {}) {
  await page.addInitScript(
    ({
      workspace,
      geometry,
      profile,
      validation,
      extraGeometries,
      scanMatches,
    }: Fixture) => {
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
            Geometries: async () => [geometry, ...extraGeometries],
            ...(scanMatches
              ? {
                  InputScan: async (deviceID: string) => ({
                    device_id: deviceID,
                    token_namespace: "kmonad-v1",
                    keys: geometry.keys.map((key) => key.source_key),
                    unmapped_count: 0,
                    generation: 1,
                    digest: "sha256:scan",
                    observed_at: "2026-10-01T00:00:00Z",
                  }),
                  MatchInputScan: async () => scanMatches,
                }
              : {}),
            ExportProfile: async () => {},
            IdentifyStart: async () => ({
              id: "identify-1",
              kind: "identify",
              state: "waiting",
              reason_code: "operation_waiting",
              reason: "Waiting for a keypress.",
            }),
            IdentifyOperation: async () => ({
              id: "identify-1",
              kind: "identify",
              state: "succeeded",
              reason_code: "operation_succeeded",
              reason: "A key press arrived from the selected keyboard.",
            }),
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
              validation,
              candidate_digest: "sha256:fixture",
              source_map: [],
            }),
          },
        },
      };
    },
    {
      workspace,
      geometry: tkl,
      profile,
      validation: validPreview,
      extraGeometries: [],
      scanMatches: null,
      ...fixture,
    },
  );
  await page.goto("/");
  // The first load from the shared Vite dev server can be slow while many
  // workers start at once.
  await expect(page.getByText("Manager ready", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

async function openEditor(page: Page, fixture: Partial<Fixture> = {}) {
  await openWorkspace(page, fixture);
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
    await page.getByRole("button", { name: "Tap & hold", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

// Returns the contrast of every visible button's label against the first
// opaque background behind it, split into enabled and disabled buttons.
async function buttonContrasts(page: Page, scope: string) {
  return page.locator(scope).evaluate((root) => {
    const channels = (color: string) =>
      (color.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (color: string) => {
      const [r, g, b] = channels(color).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const background = (element: Element | null): string => {
      for (let node = element; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        const alpha = channels(color)[3];
        if (color !== "transparent" && (alpha === undefined || alpha > 0.9))
          return color;
      }
      return "rgb(255, 255, 255)";
    };
    return [...root.querySelectorAll<HTMLButtonElement>("button.button")]
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => {
        const [high, low] = [
          luminance(getComputedStyle(button).color),
          luminance(background(button)),
        ].sort((a, b) => b - a);
        return {
          label: button.textContent?.trim() ?? "",
          disabled: button.disabled,
          ratio: Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100,
        };
      });
  });
}

async function expectReadableButtons(page: Page, scope: string) {
  const contrasts = await buttonContrasts(page, scope);
  expect(contrasts.length).toBeGreaterThan(0);
  for (const { label, disabled, ratio } of contrasts) {
    expect(
      ratio,
      `${disabled ? "disabled" : "enabled"} “${label}” in ${scope}`,
    ).toBeGreaterThanOrEqual(disabled ? 3 : 4.5);
  }
}

test("keeps every dialog and setup button readable", async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-source-key="caps"]').click();
  for (const opener of ["Tap & hold", "Layer action", "Alias", "Macro"]) {
    await page.getByRole("button", { name: opener, exact: true }).click();
    await expectReadableButtons(page, "dialog");
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await expectReadableButtons(page, "dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Apply to keyboard" }).click();
  await expectReadableButtons(page, "dialog");
  await page.keyboard.press("Escape");
  await expectReadableButtons(page, ".editor-page");
  await page.locator(".profile-switcher").click();
  await expectReadableButtons(page, ".editor-heading");
  await page.getByRole("menuitem", { name: "Rename or delete…" }).click();
  await expectReadableButtons(page, "dialog");
  await page.getByRole("button", { name: "New profile" }).click();
  await expectReadableButtons(page, ".setup-page");
});

test("keeps the editor header to one uncluttered row", async ({ page }) => {
  for (const width of [1180, 760]) {
    await page.setViewportSize({ width, height: 820 });
    if (width === 1180) await openEditor(page);
    const boxes = await page
      .locator(".editor-heading > *")
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const box = element.getBoundingClientRect();
            return {
              name: element.className,
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            };
          }),
      );
    for (const [index, box] of boxes.entries()) {
      expect(box.right, box.name).toBeLessThanOrEqual(width);
      for (const other of boxes.slice(index + 1)) {
        const overlaps =
          box.left < other.right - 1 &&
          other.left < box.right - 1 &&
          box.top < other.bottom - 1 &&
          other.top < box.bottom - 1;
        expect(overlaps, `${box.name} overlaps ${other.name}`).toBe(false);
      }
    }
    if (width === 1180) {
      const centers = boxes.map((box) => (box.top + box.bottom) / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(12);
    }
  }

  // The overflow menu is keyboard operable and explains disabled actions.
  const more = page.getByRole("button", { name: "More profile actions" });
  await more.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "More profile actions" });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: /View \.kbd/ }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("names the validation state and why Apply is unavailable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openEditor(page, {
    validation: {
      outcome: "rejected",
      reason_code: "validation_rejected",
      reason: "KMonad rejected the rendered configuration.",
      diagnostics: [
        {
          id: "diagnostic-1",
          severity: "error",
          reason_code: "unknown_key",
          summary: "Unknown key name in deflayer nav",
          remediation: "Choose a key from the palette.",
        },
      ],
    },
  });
  const indicator = page.locator(".configuration-indicator");
  await expect(indicator).toHaveAttribute("data-state", "rejected");
  await expect(indicator).toHaveText("Invalid configuration");
  await expect(page.locator(".editor-apply")).toBeDisabled();
  await expect(page.locator(".apply-blocked")).toHaveText(
    "Apply unavailable: the draft is invalid. Fix the problems below.",
  );
  const problems = page.locator(".preview-message");
  await expect(problems).toContainText("1 problem in this draft");
  await expect(problems).toContainText("Unknown key name in deflayer nav");
  // The problems strip sits above the keyboard instead of covering keys.
  const strip = await problems.boundingBox();
  const keyboard = await page.locator(".keyboard-editor").boundingBox();
  expect(strip!.y + strip!.height).toBeLessThanOrEqual(keyboard!.y);
  await problems.getByRole("button", { name: "Hide details" }).click();
  await expect(problems.getByText("Unknown key name")).toBeHidden();
  await problems.getByRole("button", { name: "Show details" }).click();
  await expect(problems.getByText("Unknown key name")).toBeVisible();
});

test("explains that a disconnected keyboard blocks Apply", async ({ page }) => {
  const disconnected = structuredClone(workspace);
  disconnected.snapshot!.devices![0].availability = "disconnected";
  await openEditor(page, { workspace: disconnected });
  await expect(page.locator(".configuration-indicator")).toHaveText(
    "Valid configuration",
  );
  await expect(page.locator(".apply-blocked")).toHaveText(
    "Apply unavailable: the keyboard is disconnected.",
  );
  await expect(page.locator(".editor-apply")).toHaveAttribute(
    "title",
    "Apply unavailable: the keyboard is disconnected.",
  );
});

test("inspects the selected key and edits its existing behavior", async ({
  page,
}) => {
  await openEditor(page);
  const inspector = page.getByRole("group", { name: "Selected key" });
  await expect(inspector).toContainText("Click a key, or press it");

  const caps = page.locator('.editor-key[data-source-key="caps"]');
  await expect(caps).toHaveAttribute(
    "title",
    "CAPS: Tap: Esc · Hold: Left Ctrl · 200 ms",
  );
  await caps.click();
  await expect(inspector).toContainText("Base layer");
  await expect(inspector).toContainText("Tap: Esc · Hold: Left Ctrl · 200 ms");
  await inspector.getByRole("button", { name: "Edit tap & hold" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Tap", { exact: true })).toHaveAttribute(
    "data-value",
    "esc",
  );
  await expect(dialog.getByLabel("Held key")).toHaveAttribute(
    "data-value",
    "lctl",
  );
  await dialog.getByLabel("Tap timeout (milliseconds)").fill("250");
  await dialog.getByRole("button", { name: "Update tap & hold" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inspector).toContainText("Tap: Esc · Hold: Left Ctrl · 250 ms");

  // Space holds a layer; the layer dialog opens on its current target.
  await page.locator('.editor-key[data-source-key="spc"]').click();
  await expect(inspector).toContainText(
    "Tap: Space · Hold: Navigation layer · 200 ms",
  );

  // A plain key on an overlay layer shows what falls through from Base.
  await page
    .getByRole("tablist", { name: "Keymap layers" })
    .getByRole("tab", { name: "Navigation" })
    .click();
  await page.locator('.editor-key[data-source-key="a"]').click();
  await expect(inspector).toContainText("Passes through to the layer below");
  await expect(inspector).toContainText("Base: Sends A (unchanged)");
  await expect(
    inspector.getByRole("button", { name: "Restore original" }),
  ).toBeDisabled();
  await page.locator('.editor-key[data-source-key="h"]').click();
  await expect(inspector).toContainText("Sends Left arrow");
  await inspector.getByRole("button", { name: "Disable key" }).click();
  await expect(inspector).toContainText("Sends nothing (disabled)");
  await expect(
    inspector.getByRole("button", { name: "Disable key" }),
  ).toBeDisabled();
  await inspector.getByRole("button", { name: "Restore original" }).click();
  await expect(inspector).toContainText("Passes through to the layer below");
});

test("leads the palette with common keys and unambiguous labels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openEditor(page);
  await expect(page.locator(".palette-group-heading").first()).toHaveText(
    "Common keys",
  );
  const keys = page.locator(".palette-key");
  expect(
    await keys.evaluateAll((elements) =>
      elements.slice(0, 5).map((key) => key.getAttribute("title")),
    ),
  ).toEqual([
    "Esc (esc)",
    "Tab (tab)",
    "Enter (ret)",
    "Space (spc)",
    "Backspace (bspc)",
  ]);
  // Every cap shows a distinct label or icon, so left and right modifiers are
  // told apart without reading the KMonad code underneath.
  const caps = await keys.evaluateAll((elements) =>
    elements.map(
      (key) =>
        key.querySelector("svg")?.dataset.icon ??
        key.querySelector("span")?.textContent?.trim(),
    ),
  );
  expect(caps.filter((label, index) => caps.indexOf(label) !== index)).toEqual(
    [],
  );
  expect(caps).toEqual(expect.arrayContaining(["L Ctrl", "R Ctrl", "L Alt"]));
});

test("picks keys in action dialogs by search or by pressing them", async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('.editor-key[data-source-key="f"]').click();
  await page.getByRole("button", { name: "Tap & hold", exact: true }).click();
  const dialog = page.getByRole("dialog");
  // A new tap-hold starts as a home-row modifier on the key's own output.
  const tap = dialog.getByLabel("Tap", { exact: true });
  const held = dialog.getByLabel("Held key");
  await expect(tap).toHaveAttribute("data-value", "f");
  await expect(held).toHaveAttribute("data-value", "lctl");

  await held.click();
  const search = dialog.getByRole("combobox", { name: "Search keys" });
  await expect(search).toBeFocused();
  await search.fill("shift");
  await expect(
    dialog.getByRole("listbox", { name: "Keys" }).getByRole("option"),
  ).toHaveText([/Left Shift/, /Right Shift/]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(held).toHaveAttribute("data-value", "rsft");
  await expect(held).toBeFocused();

  // Escape closes only the picker; the dialog stays open.
  await held.click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // Pressing a key picks it, including Escape itself.
  await tap.click();
  await dialog.getByRole("button", { name: "Press a key" }).click();
  await page.keyboard.press("Escape");
  await expect(tap).toHaveAttribute("data-value", "esc");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Assign tap & hold" }).click();
  await expect(page.getByRole("group", { name: "Selected key" })).toContainText(
    "Tap: Esc · Hold: Right Shift · 200 ms",
  );

  // Macro steps can be reordered before saving.
  await page.getByRole("button", { name: "Macro", exact: true }).click();
  await dialog.getByLabel("Macro name").fill("greet");
  const nextKey = dialog.getByLabel("Add a key press");
  for (const code of ["KeyH", "KeyI"]) {
    await nextKey.click();
    await dialog.getByRole("button", { name: "Press a key" }).click();
    await page.keyboard.press(code);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
  }
  const steps = dialog.getByRole("list", { name: "Macro key sequence" });
  await expect(steps.getByRole("listitem")).toHaveText([/^H/, /^I/]);
  await dialog.getByRole("button", { name: "Move step 2 earlier" }).click();
  await expect(steps.getByRole("listitem")).toHaveText([/^I/, /^H/]);
  await dialog.getByRole("button", { name: "Create and assign macro" }).click();
  await expect(page.getByRole("group", { name: "Selected key" })).toContainText(
    "Macro #greet: I, H",
  );
});

test("styles the add-layer field like other dialog inputs", async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const input = page.getByLabel("Add a layer");
  await expect(input).toHaveCSS("border-radius", "8px");
  await expect(input).toHaveCSS("min-height", "40px");
});

test("diffs a draft against its last applied state", () => {
  const applied = {
    draft_revision: 3,
    configuration_revision: 7,
    applied_at: "2026-09-30T09:00:00Z",
    layers: [
      { id: "base", name: "Base" },
      { id: "layer-nav", name: "Nav" },
      { id: "layer-old", name: "Old" },
    ],
    assignments: [
      // Go omits empty fields; the editor may send explicit nulls.
      {
        layer_id: "base",
        source_key: "a",
        behavior: { kind: "key", key: "b" },
      },
      {
        layer_id: "base",
        source_key: "caps",
        behavior: { kind: "key", key: "esc" },
      },
      {
        layer_id: "layer-nav",
        source_key: "h",
        behavior: { kind: "key", key: "left" },
      },
    ],
    aliases: { keep: { kind: "key", key: "x" } },
  };
  const diff = diffAgainstApplied(applied, {
    layers: [
      { id: "base", name: "Base" },
      { id: "layer-nav", name: "Navigation" },
      { id: "layer-sym", name: "Symbols" },
    ],
    assignments: [
      {
        layer_id: "base",
        source_key: "a",
        behavior: { key: "b", kind: "key", target: null } as never,
      },
      {
        layer_id: "base",
        source_key: "caps",
        behavior: { kind: "key", key: "lctl" },
      },
      { layer_id: "base", source_key: "z", behavior: { kind: "disabled" } },
    ],
    aliases: { keep: { kind: "key", key: "x" } },
    macros: { greet: [{ kind: "key", key: "h" }] },
  });
  expect(
    diff.assignments.map(({ kind, layerID, sourceKey }) => [
      kind,
      layerID,
      sourceKey,
    ]),
  ).toEqual([
    ["changed", "base", "caps"],
    ["added", "base", "z"],
    ["removed", "layer-nav", "h"],
  ]);
  expect(diff.layers).toEqual([
    {
      kind: "changed",
      id: "layer-nav",
      name: "Navigation",
      beforeName: "Nav",
    },
    { kind: "added", id: "layer-sym", name: "Symbols" },
    { kind: "removed", id: "layer-old", name: "Old" },
  ]);
  expect(diff.declarations).toEqual([
    { kind: "added", name: "greet", type: "macro" },
  ]);
  expect(diff.count).toBe(7);
  // A first Apply lists every explicit assignment as added.
  expect(
    diffAgainstApplied(undefined, {
      layers: [{ id: "base", name: "Base" }],
      assignments: applied.assignments,
    }).assignments.every((change) => change.kind === "added"),
  ).toBe(true);
});

test("reviews only the changes since the last Apply", async ({ page }) => {
  const drifted = structuredClone(workspace);
  drifted.snapshot!.configurations![0].active_revision = 8;
  await openEditor(page, {
    workspace: drifted,
    profile: {
      ...profile,
      applied: {
        draft_revision: 2,
        configuration_revision: 7,
        applied_at: "2026-09-29T18:00:00Z",
        layers: profile.layers,
        assignments: [
          {
            layer_id: "base",
            source_key: "caps",
            behavior: { kind: "key", key: "esc" },
          },
          ...profile.assignments!.slice(1),
          {
            layer_id: "layer-nav",
            source_key: "j",
            behavior: { kind: "key", key: "down" },
          },
        ],
      },
    },
  });
  await page.getByRole("button", { name: "Apply to keyboard" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Changes since this profile was last applied",
  );
  await expect(dialog.getByRole("status")).toContainText(
    "The keyboard now runs revision 8, not revision 7",
  );
  const changes = dialog
    .getByRole("list", { name: "Changes to apply" })
    .getByRole("listitem");
  await expect(changes).toHaveText([
    "Changed Base · Caps Lock Sends Esc → Tap: Esc · Hold: Left Ctrl · 200 ms",
    "Removed Navigation · J Sends Down arrow → Passes through to the layer below",
  ]);
});

test("summarises each keyboard's mapping in one line", async ({ page }) => {
  await openWorkspace(page);
  const configuration = page.getByRole("region", {
    name: "Configuration Home row mods",
  });
  await expect(configuration.locator(".configuration-summary")).toHaveText(
    /Home row mods\s*Healthy/,
  );
  // Revisions and lifecycle actions wait behind a disclosure.
  await expect(configuration.getByText("Desired")).toBeHidden();
  await expect(
    configuration.getByRole("button", { name: "Remove from keyboard" }),
  ).toBeHidden();
  await configuration.getByText("Details").click();
  await expect(configuration.getByText("Desired")).toBeVisible();
  // A keyboard with a profile shows its layout instead of a generic glyph.
  await expect(page.locator(".device-card .keyboard-preview rect")).toHaveCount(
    tkl.keys.length,
  );
});

test("confirms destructive actions in one dialog above the current one", async ({
  page,
}) => {
  await openEditor(page);
  await page.locator(".profile-switcher").click();
  await page.getByRole("menuitem", { name: "Rename or delete…" }).click();
  const deleteProfile = page.getByRole("button", { name: "Delete profile" });
  await deleteProfile.click();
  const confirm = page.getByRole("alertdialog", {
    name: "Delete “Home row mods”?",
  });
  await expect(confirm).toContainText("keeps running");
  // Escape answers only the confirmation; the Profiles dialog stays open and
  // focus returns to the button that asked.
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Profiles" })).toBeVisible();
  await expect(deleteProfile).toBeFocused();
});

test("shows results as toasts and keeps dialog validation in the dialog", async ({
  page,
}) => {
  await page.clock.install();
  await openEditor(page);
  // A failing action leaves an error toast until it is dismissed.
  await page.locator(".profile-switcher").click();
  await page.getByRole("menuitem", { name: "Duplicate this profile" }).click();
  const errorToast = page
    .locator(".toast-region")
    .getByRole("alert")
    .locator(".toast");
  await expect(errorToast).toContainText(
    "Wails binding DuplicateProfile is unavailable.",
  );
  await page.clock.runFor(30_000);
  await expect(errorToast).toHaveCount(1);
  await errorToast.getByRole("button", { name: "Dismiss error" }).click();
  await expect(errorToast).toHaveCount(0);

  // Field validation appears inside the dialog that caused it.
  await page.locator('.editor-key[data-source-key="a"]').click();
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Alias", exact: true }).click();
  await dialog.getByLabel("Alias name").fill("home");
  await dialog.getByRole("button", { name: "Create and assign alias" }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.editor-key[data-source-key="s"]').click();
  await page.getByRole("button", { name: "Alias", exact: true }).click();
  await dialog.getByLabel("Alias name").fill("home");
  await dialog.getByRole("button", { name: "Create and assign alias" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "That alias or macro name is already in use.",
  );
  await page.keyboard.press("Escape");

  // A successful result dismisses itself.
  await page.getByRole("button", { name: "More profile actions" }).click();
  await page.getByRole("menuitem", { name: "Export profile…" }).click();
  const resultToast = page
    .locator(".toast-region")
    .getByRole("status")
    .locator(".toast");
  await expect(resultToast).toContainText("Portable profile exported.");
  await page.clock.runFor(7_000);
  await expect(resultToast).toHaveCount(0);
});

test("shows how each layer is reached and what falls through", async ({
  page,
}) => {
  await openEditor(page, {
    profile: {
      ...profile,
      layers: [...profile.layers, { id: "layer-sym", name: "Symbols" }],
    },
  });
  const tabs = page.getByRole("tablist", { name: "Keymap layers" });
  const navigation = tabs.getByRole("tab", { name: "Navigation" });
  await expect(navigation).toContainText("via Space (hold)");
  await expect(navigation).toHaveAccessibleDescription(
    "Entered via Space (hold)",
  );
  const symbols = tabs.getByRole("tab", { name: "Symbols" });
  await expect(symbols).toContainText("no entry key");
  await expect(symbols).toHaveClass(/unreachable/);

  // The explainer is available on demand instead of always taking space.
  await expect(page.getByText("How layers work", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "How layers work" }).click();
  await expect(page.locator("#layer-help")).toContainText(
    "Base is always active",
  );

  await navigation.click();
  const a = page.locator('.editor-key[data-source-key="a"]');
  await expect(a).toHaveClass(/fallthrough-key/);
  await expect(a.locator("small")).toHaveText("a");
  const h = page.locator('.editor-key[data-source-key="h"]');
  await expect(h).not.toHaveClass(/fallthrough-key/);
  await expect(h.locator("small")).toHaveText("left");
});

const withSpareKeyboard = structuredClone(workspace);
withSpareKeyboard.snapshot!.devices!.push({
  ...workspace.snapshot!.devices![0],
  id: "device-2",
  display_name: "Spare keyboard",
  configured_by: null,
});
const sixtyPercent: GeometryTemplate = {
  ...tkl,
  id: "us-ansi-60-fixture",
  name: "US ANSI 60%",
  description: "A smaller fixture layout",
  keys: tkl.keys.filter((key) => key.row > 0 && key.row < 6).slice(0, 61),
};

test("detects the layout during setup and explains the candidates", async ({
  page,
}) => {
  await openWorkspace(page, {
    workspace: withSpareKeyboard,
    extraGeometries: [sixtyPercent],
    scanMatches: [
      {
        geometry_id: tkl.id,
        name: tkl.name,
        kind: "exact",
        missing: 0,
        extra: 0,
      },
      {
        geometry_id: sixtyPercent.id,
        name: sixtyPercent.name,
        kind: "superset",
        missing: 0,
        extra: 23,
      },
    ],
  });
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await expect(page.getByLabel("Profile name")).toHaveValue(
    "Spare keyboard profile",
  );
  await expect(page.getByLabel("Physical layout")).toHaveValue(tkl.id);
  await expect(
    page.getByRole("status").filter({ hasText: "Detected" }),
  ).toHaveText(
    `✓ Detected: this keyboard reports exactly the keys of ${tkl.name}.`,
  );
  await expect(page.locator(".setup-layout-preview rect")).toHaveCount(
    tkl.keys.length,
  );
  const candidate = page.getByRole("button", { name: /US ANSI 60%/ });
  await expect(candidate).toContainText(
    "Close: your keyboard has 23 keys this layout doesn't include",
  );
  await candidate.click();
  await expect(page.getByLabel("Physical layout")).toHaveValue(sixtyPercent.id);
  await expect(candidate).toHaveAttribute("aria-pressed", "true");
});

test("asks for a layout when detection is unavailable", async ({ page }) => {
  await openWorkspace(page, {
    workspace: withSpareKeyboard,
    extraGeometries: [sixtyPercent],
  });
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  // No layout is carried over or defaulted from the catalog order.
  await expect(page.getByLabel("Physical layout")).toHaveValue("");
  const create = page.getByRole("button", { name: "Create draft" });
  await expect(create).toBeDisabled();
  await page.getByLabel("Physical layout").selectOption(sixtyPercent.id);
  await expect(create).toBeEnabled();
});

test("reports the last Apply plainly and keeps internals in a disclosure", async ({
  page,
}) => {
  await openEditor(page, {
    profile: {
      ...profile,
      last_apply_operation: {
        id: "op-9",
        kind: "apply",
        state: "succeeded",
        reason_code: "operation_succeeded",
        reason: "configuration persisted and activation confirmed",
        configuration_revision: 7,
      },
      applied: {
        draft_revision: 3,
        configuration_revision: 7,
        applied_at: "2026-09-30T09:00:00Z",
        layers: profile.layers,
        assignments: profile.assignments,
      },
    },
  });
  const outcome = page.locator(".apply-outcome");
  await expect(outcome.locator("p").first()).toHaveText(
    "Applied to the keyboard. The manager confirmed the new mapping is running.",
  );
  const details = outcome.getByText("Manager-reported active revision", {
    exact: false,
  });
  await expect(details).toBeHidden();
  await outcome.getByText("Technical details").click();
  await expect(details).toBeVisible();

  await page.locator('.editor-key[data-source-key="f"]').click();
  await page.getByRole("button", { name: "Disable key" }).click();
  await expect(page.locator(".changes-bar")).toContainText(
    "1 key change since the last Apply.",
  );
});

test("finishes identification with a way to configure the keyboard", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Identify", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Start/ }).click();
  await expect(
    dialog.getByRole("heading", { name: "Found it!" }),
  ).toBeVisible();
  await expect(dialog.locator(".operation-status")).toHaveText(
    "Key press detected",
  );
  await dialog.getByRole("button", { name: "Edit draft" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".editor-key")).toHaveCount(tkl.keys.length);
});

test("keeps header controls compact and the version in About", async ({
  page,
}) => {
  await openEditor(page);
  for (const name of ["Undo", "Redo"]) {
    const icon = page.getByRole("button", { name, exact: true }).locator("svg");
    await expect(icon).toHaveCSS("width", "18px");
  }
  const preferences = page.getByRole("button", { name: "Preferences" });
  await expect(preferences).toHaveCSS("border-top-style", "none");
  await expect(page.getByText("test", { exact: true })).toHaveCount(0);
  await preferences.click();
  await expect(page.getByRole("dialog")).toContainText("Version test");
});

test("marks remapped keys and the changes not yet applied", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openEditor(page, {
    profile: {
      ...profile,
      applied: {
        draft_revision: 2,
        configuration_revision: 7,
        applied_at: "2026-09-29T18:00:00Z",
        layers: profile.layers,
        assignments: [profile.assignments![0], profile.assignments![2]],
      },
    },
  });
  const caps = page.locator('.editor-key[data-source-key="caps"]');
  const space = page.locator('.editor-key[data-source-key="spc"]');
  // Tap-hold caps show both actions instead of a truncated sentence.
  await expect(caps.locator("small")).toHaveText("esc↓ lctl");
  await expect(space.locator(".cap-hold")).toHaveText("↓ Navigation");
  await expect(caps).toHaveClass(/remapped-key/);
  await expect(
    page.locator('.editor-key[data-source-key="a"]'),
  ).not.toHaveClass(/remapped-key/);
  // Only Space differs from the last Apply.
  const bar = page.locator(".changes-bar");
  await expect(bar).toContainText("1 key change since the last Apply.");
  await expect(page.locator(".changed-key")).toHaveCount(0);
  await bar.getByRole("button", { name: "Show on keyboard" }).click();
  await expect(page.locator(".changed-key")).toHaveCount(1);
  await expect(space).toHaveAttribute("data-change", "added");
  await page.locator('[data-source-key="caps"]').click();
  await page.getByRole("button", { name: "Disable key" }).click();
  await expect(caps).toHaveAttribute("data-change", "changed");
  await expect(bar).toContainText("2 key changes since the last Apply.");
  await page
    .getByRole("tablist", { name: "Keymap layers" })
    .getByRole("tab", { name: "Navigation" })
    .click();
  await expect(bar).toContainText("Changes are on Base.");
});

test("edits from the keyboard: select, move, search, restore", async ({
  page,
}) => {
  await openEditor(page);
  const inspector = page.getByRole("group", { name: "Selected key" });
  // With nothing selected, pressing a physical key selects it.
  await page.keyboard.press("KeyF");
  const f = page.locator('.editor-key[data-source-key="f"]');
  await expect(f).toHaveClass(/selected-key/);
  await expect(f).toBeFocused();
  await expect(inspector.locator("strong").first()).toHaveText("F");
  // Arrows move the selection to the neighbouring key.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".selected-key")).toHaveAttribute(
    "data-source-key",
    "g",
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".selected-key")).toHaveAttribute(
    "data-source-key",
    "t",
  );
  // Typing searches the palette; Enter on a result assigns it.
  await page.keyboard.press("e");
  const search = page.getByLabel("Search keys", { exact: true });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("e");
  await page.keyboard.type("sc");
  await expect(page.locator(".palette-key")).toHaveCount(1);
  await page.locator(".palette-key").click();
  await expect(inspector).toContainText("Sends Esc");
  // Delete restores, Escape deselects.
  await page.locator('.editor-key[data-source-key="t"]').focus();
  await page.keyboard.press("Delete");
  await expect(inspector).toContainText("Sends T (unchanged)");
  await page.keyboard.press("Escape");
  await expect(page.locator(".selected-key")).toHaveCount(0);
  // "?" lists the shortcuts; Escape closes only that dialog.
  await page.keyboard.press("Shift+Slash");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toContainText("Select the neighbouring key");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // A modifier tapped alone selects it; used in a combination it does not.
  await page.keyboard.press("ShiftLeft");
  await expect(page.locator(".selected-key")).toHaveAttribute(
    "data-source-key",
    "lsft",
  );
  await page.keyboard.press("Escape");
  // Space and Enter keep activating a focused button.
  await page.getByRole("button", { name: "Manage", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Manage layers" }),
  ).toBeVisible();
  await expect(page.locator(".selected-key")).toHaveCount(0);
});
