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
    menu.getByRole("menuitem", { name: /Export profile/ }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
});
