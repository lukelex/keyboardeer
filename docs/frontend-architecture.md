# Frontend architecture

The Svelte 5 frontend (`frontend/src/`) is split into layers that depend only
downward. Components use runes (`$props`, `$state`, `$derived`, snippets and
callback props).

| Layer | Folder | Responsibility | May depend on |
|---|---|---|---|
| Platform | `platform/` | The typed Wails bridge (`desktop.ts`) and binding detection (`bindings.ts`). | — |
| Domain | `domain/` | Pure TypeScript: no Svelte, no I/O. Immutable models and rules. | platform types |
| State | `state/*.svelte.ts` | One reactive class per responsibility. Talks to the platform layer. | domain, platform |
| Actions | `actions/` | Reusable DOM behaviour (`use:` actions). | — |
| Components | `components/` | Shared, app-agnostic UI. Props in, callbacks out. | domain, actions |
| Features | `features/<area>/` | Screens and dialogs. Read services from context. | everything above |

## Domain

- `KeyCatalog` — the output keys assignable for one verified geometry,
  grouped and ordered for the palette and key pickers, with readable names.
- `Keymap` — read-only queries for one profile revision (legends,
  descriptions, layer reachability) and copy-on-write edits that return a new
  profile. A new `Keymap` exists per saved revision, so it can cache safely.
- `actionDefaults.ts` — initial values for the complex-action dialogs.
- `applyDiff.ts`, `validationRecovery.ts`, `kmonadFormat.ts`, `devices.ts`,
  `operations.ts`, `validation.ts`, `text.ts` — pure helpers.

## State

Each class owns one responsibility and receives its collaborators through the
constructor. Classes that need something from their owner declare a small
host or observer interface instead of importing it.

| Class | Responsibility |
|---|---|
| `ManagerConnection` | The manager workspace snapshot, capabilities, and change notifications (`ConnectionObserver`). |
| `ProfileLibrary` | Stored profiles, selected profile per keyboard, layouts, store health; the `busy` lock for profile mutations. |
| `DraftEditor` | One editing session: active profile, selected layer and key, every draft edit. |
| `DraftHistory` | Per-profile undo and redo. |
| `PreviewValidator` | Debounced, single-flight whole-draft validation (`PreviewHost`). |
| `ApplyController` | Review, Apply, and recovery of applies with unknown outcomes (`ApplyHost`). |
| `SetupForm` | The new-profile form and layout detection. |
| `IdentifySession` | Manager-owned keyboard identification. |
| `ConfigurationActions` | Enable, disable, remove and adopt manager configurations. |
| `SourceViewer` | The rendered `.kbd` and external configuration sources. |
| `RuntimeHealthMonitor` | Reports managed mappings that stop running or recover, as toasts and (when unfocused) desktop notifications through the Go `Notify` binding. |
| `PreferencesStore`, `Navigation`, `LocalSettings` | Preferences; current screen and keyboard; browser-local conveniences. |
| `ToastCenter`, `ConfirmationService`, `DialogStack` | Toasts; the one confirmation dialog; Escape closes the topmost dialog. |
| `KeyboarDeer` | The composition root: builds and wires the services, and implements use cases that span several of them (open a keyboard, switch or delete a profile, restore the last screen). |

`App.svelte` creates one `KeyboarDeer` and provides it with `provideApp`
(`state/context.ts`, built on Svelte's `createContext`). Feature components
call `useApp()`. Shared components never do; `Dialog` reads only the
`DialogStack` context.

## Dialogs

Every dialog renders from `features/shell/DialogLayer.svelte`, directly inside
`.app-shell`, because `actions/modal.ts` makes every other child of the shell
inert while a dialog is open. `components/Dialog.svelte` provides the
backdrop, close button, focus handling and dialog-stack registration. Each
dialog keeps its own form state, initialised from the domain defaults when it
opens.

## Conventions

- Store server data with `$state.raw` and replace it immutably; use deep
  `$state` only for local form values.
- Use `$derived.by(() => …)` for class fields that read collaborators assigned
  in the constructor.
- Prefer a writable `$derived` over an `$effect` that copies state.
- Put rules in `domain/` and test them directly in `tests/domain.spec.ts`.
  Test behaviour through the UI in `tests/ux.spec.ts` and
  `tests/workspace.spec.ts`.

## Colour and theming

`app.css` defines semantic colour tokens on `:root`, grouped as surfaces
(`--page`, `--surface`, `--surface-tint`, `--surface-selected`, …), text
(`--text`, `--text-muted`, `--text-danger`, …), borders (`--border`,
`--border-control`, …) and status colours (`--status-success`, …). Rules use
tokens, never literal colours, except on permanently dark surfaces (the
header, toasts and code blocks), which look the same in both themes.

Dark values apply when the system prefers dark, unless the person chose Light
in Preferences (`html[data-theme="light"]`), or when they chose Dark
(`html[data-theme="dark"]`). Keep text tokens at WCAG AA (4.5:1) against the
surfaces they sit on in both themes; `tests/ux.spec.ts` checks button contrast
in light and dark mode.
