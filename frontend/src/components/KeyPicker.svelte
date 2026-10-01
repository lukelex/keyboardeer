<script lang="ts">
  import { tick } from "svelte";
  import type { KeyChoiceGroup } from "../domain/keyCatalog";

  // Picks one output key from the same grouped catalog as the palette:
  // search by name or KMonad code, or press the key itself.
  interface Props {
    id: string;
    value: string;
    groups: KeyChoiceGroup[];
    /** Maps KeyboardEvent.code to a KMonad source key for "Press a key". */
    captureMap: Readonly<Record<string, string>>;
    disabled?: boolean;
  }
  let {
    id,
    value = $bindable(),
    groups,
    captureMap,
    disabled = false,
  }: Props = $props();

  let open = $state(false);
  let query = $state("");
  let capturing = $state(false);
  let captureNotice = $state("");
  let active = $state(0);
  let search = $state<HTMLInputElement>();
  let trigger: HTMLButtonElement;
  const listID = $derived(`${id}-options`);

  const allKeys = $derived(groups.flatMap((group) => group.keys));
  const selected = $derived(allKeys.find((key) => key.source_key === value));
  const filteredGroups = $derived.by(() => {
    const normalized = query.trim().toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        keys: normalized
          ? group.keys.filter(
              (key) =>
                key.name.toLowerCase().includes(normalized) ||
                key.source_key.toLowerCase().includes(normalized),
            )
          : group.keys,
      }))
      .filter((group) => group.keys.length);
  });
  const visibleKeys = $derived(filteredGroups.flatMap((group) => group.keys));
  const activeIndex = $derived(
    Math.min(active, Math.max(0, visibleKeys.length - 1)),
  );

  // The KMonad code is shown only when it differs from the visible name.
  function showCode(key: { source_key: string; name: string }) {
    return key.source_key !== key.name.toLowerCase();
  }
  async function show() {
    open = true;
    query = "";
    captureNotice = "";
    active = Math.max(
      0,
      allKeys.findIndex((key) => key.source_key === value),
    );
    await tick();
    search?.focus();
    scrollActiveIntoView();
  }
  function hide() {
    open = false;
    stopCapture();
    trigger?.focus();
  }
  function choose(sourceKey: string) {
    value = sourceKey;
    hide();
  }
  function scrollActiveIntoView() {
    document
      .getElementById(`${id}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }
  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (activeIndex + step + visibleKeys.length) % visibleKeys.length;
      scrollActiveIntoView();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (visibleKeys[activeIndex]) choose(visibleKeys[activeIndex].source_key);
    } else if (event.key === "Escape") {
      // Closes the picker, not the dialog around it.
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  }
  function captureKey(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    const sourceKey = captureMap[event.code];
    if (sourceKey && allKeys.some((key) => key.source_key === sourceKey)) {
      choose(sourceKey);
    } else {
      captureNotice = "That key is not available here. Try another, or search.";
    }
  }
  function startCapture() {
    capturing = true;
    captureNotice = "";
    window.addEventListener("keydown", captureKey, { capture: true });
  }
  function stopCapture() {
    capturing = false;
    window.removeEventListener("keydown", captureKey, { capture: true });
  }
  $effect(() => stopCapture);
</script>

<div class="key-picker">
  <button
    bind:this={trigger}
    {id}
    class="key-picker-trigger"
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    data-value={value}
    {disabled}
    onclick={() => (open ? hide() : void show())}
  >
    <span>{selected?.name ?? "Choose a key"}</span>
    {#if selected && showCode(selected)}<small>{selected.source_key}</small
      >{/if}
    <span class="key-picker-chevron" aria-hidden="true">▾</span>
  </button>
  {#if open}
    <div class="key-picker-panel">
      <div class="key-picker-tools">
        <input
          bind:this={search}
          bind:value={query}
          type="search"
          role="combobox"
          aria-label="Search keys"
          aria-controls={listID}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={visibleKeys[activeIndex]
            ? `${id}-option-${activeIndex}`
            : undefined}
          placeholder="Name or KMonad code"
          autocomplete="off"
          disabled={capturing}
          oninput={() => (active = 0)}
          onkeydown={handleSearchKeydown}
        />
        {#if capturing}
          <button class="button secondary" type="button" onclick={stopCapture}
            >Cancel</button
          >
        {:else}
          <button
            class="button secondary"
            type="button"
            onclick={startCapture}
            title="Press the key you want on your keyboard">Press a key</button
          >
        {/if}
      </div>
      {#if capturing}
        <p class="key-picker-capture" role="status">
          Press the key you want on your keyboard…
        </p>
      {/if}
      {#if captureNotice}
        <p class="key-picker-notice" role="status">{captureNotice}</p>
      {/if}
      <div class="key-picker-list" id={listID} role="listbox" aria-label="Keys">
        {#each filteredGroups as group (group.heading)}
          <div role="group" aria-label={group.heading}>
            <strong aria-hidden="true">{group.heading}</strong>
            {#each group.keys as key (key.source_key)}
              {@const index = visibleKeys.indexOf(key)}
              <button
                id={`${id}-option-${index}`}
                class={["key-picker-option", index === activeIndex && "active"]}
                type="button"
                role="option"
                aria-selected={key.source_key === value}
                tabindex="-1"
                onclick={() => choose(key.source_key)}
                onmousemove={() => (active = index)}
              >
                <span>{key.name}</span>{#if showCode(key)}<small
                    >{key.source_key}</small
                  >{/if}
              </button>
            {/each}
          </div>
        {:else}
          <p class="key-picker-notice">No keys match “{query.trim()}”.</p>
        {/each}
      </div>
    </div>
  {/if}
</div>
