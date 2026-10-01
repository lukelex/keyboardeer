<script lang="ts" module>
  export type MenuItem =
    | { separator: true }
    | {
        separator?: false;
        label: string;
        onSelect: () => void;
        disabled?: boolean;
        /** Shown under the label; explains a disabled item. */
        hint?: string;
        /** Marks the current choice in a single-choice list. */
        checked?: boolean;
        danger?: boolean;
      };
</script>

<script lang="ts">
  import { tick, type Snippet } from "svelte";

  // A WAI-ARIA menu button: arrow keys move between items, Escape or Tab
  // closes, and focus returns to the trigger after a choice.
  interface Props {
    items: MenuItem[];
    /** Names the menu. */
    label: string;
    /** Names an icon-only trigger; text triggers are named by their content. */
    triggerLabel?: string;
    triggerClass?: string;
    title?: string;
    align?: "start" | "end";
    children: Snippet;
  }
  let {
    items,
    label,
    triggerLabel = "",
    triggerClass = "",
    title = "",
    align = "start",
    children,
  }: Props = $props();

  let open = $state(false);
  let root: HTMLElement;
  let trigger: HTMLButtonElement;
  let menu = $state<HTMLElement>();
  const menuID = `menu-${Math.random().toString(36).slice(2, 9)}`;

  function enabledItems() {
    return Array.from(
      menu?.querySelectorAll<HTMLButtonElement>(
        '[role^="menuitem"]:not(:disabled)',
      ) ?? [],
    );
  }
  async function show(focus: "first" | "last" = "first") {
    open = true;
    await tick();
    const elements = enabledItems();
    // With every item disabled the menu itself takes focus, so it still
    // announces its (explained) items and closes on Escape.
    (
      (focus === "first" ? elements[0] : elements[elements.length - 1]) ?? menu
    )?.focus();
  }
  function hide(restoreFocus = true) {
    if (!open) return;
    open = false;
    if (restoreFocus) trigger?.focus();
  }
  function choose(item: Extract<MenuItem, { label: string }>) {
    if (item.disabled) return;
    hide();
    item.onSelect();
  }
  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      hide();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void show(event.key === "ArrowDown" ? "first" : "last");
    }
  }
  function handleMenuKeydown(event: KeyboardEvent) {
    const elements = enabledItems();
    const current = elements.indexOf(document.activeElement as HTMLButtonElement);
    const move = (index: number) => {
      event.preventDefault();
      elements[(index + elements.length) % elements.length]?.focus();
    };
    if (event.key === "ArrowDown") move(current + 1);
    else if (event.key === "ArrowUp") move(current - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(elements.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
    } else if (event.key === "Tab") hide(false);
  }
  function handleWindowPointerdown(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) hide(false);
  }
</script>

<svelte:window onpointerdown={handleWindowPointerdown} />

<div class="menu" bind:this={root}>
  <button
    bind:this={trigger}
    class={triggerClass}
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={menuID}
    aria-label={triggerLabel || undefined}
    title={title || undefined}
    onclick={() => (open ? hide() : void show())}
    onkeydown={handleTriggerKeydown}
  >
    {@render children()}
  </button>
  {#if open}
    <div
      bind:this={menu}
      class={["menu-popover", align === "end" && "align-end"]}
      id={menuID}
      role="menu"
      aria-label={label}
      tabindex="-1"
      onkeydown={handleMenuKeydown}
    >
      {#each items as item, index (index)}
        {#if item.separator}
          <div class="menu-separator" role="separator"></div>
        {:else}
          <button
            class={["menu-item", item.danger && "danger"]}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked}
            disabled={item.disabled}
            tabindex="-1"
            onclick={() => choose(item)}
          >
            <span class="menu-check" aria-hidden="true"
              >{item.checked ? "✓" : ""}</span
            >
            <span class="menu-label"
              >{item.label}{#if item.hint}<small>{item.hint}</small>{/if}</span
            >
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>
