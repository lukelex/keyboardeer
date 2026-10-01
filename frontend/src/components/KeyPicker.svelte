<script context="module" lang="ts">
  export type KeyPickerGroup = {
    heading: string;
    keys: { source_key: string; name: string }[];
  };
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte";

  // Picks one output key from the same grouped catalog as the palette:
  // search by name or KMonad code, or press the key itself.
  export let id: string;
  export let value: string;
  export let groups: KeyPickerGroup[];
  /** Maps KeyboardEvent.code to a KMonad source key for "Press a key". */
  export let captureMap: Record<string, string>;
  export let disabled = false;

  let open = false;
  let query = "";
  let capturing = false;
  let captureNotice = "";
  let active = 0;
  let search: HTMLInputElement | undefined;
  let trigger: HTMLButtonElement;
  const listID = `${id}-options`;

  $: allKeys = groups.flatMap((group) => group.keys);
  $: selected = allKeys.find((key) => key.source_key === value);
  $: normalized = query.trim().toLowerCase();
  $: filteredGroups = groups
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
  $: visibleKeys = filteredGroups.flatMap((group) => group.keys);
  $: if (active >= visibleKeys.length) active = Math.max(0, visibleKeys.length - 1);

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
      .getElementById(`${id}-option-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }
  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (active + step + visibleKeys.length) % visibleKeys.length;
      scrollActiveIntoView();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (visibleKeys[active]) choose(visibleKeys[active].source_key);
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
  onDestroy(stopCapture);
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
    on:click={() => (open ? hide() : void show())}
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
          aria-activedescendant={visibleKeys[active]
            ? `${id}-option-${active}`
            : undefined}
          placeholder="Name or KMonad code"
          autocomplete="off"
          disabled={capturing}
          on:input={() => (active = 0)}
          on:keydown={handleSearchKeydown}
        />
        {#if capturing}
          <button class="button secondary" type="button" on:click={stopCapture}
            >Cancel</button
          >
        {:else}
          <button
            class="button secondary"
            type="button"
            on:click={startCapture}
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
                class="key-picker-option"
                class:active={index === active}
                type="button"
                role="option"
                aria-selected={key.source_key === value}
                tabindex="-1"
                on:click={() => choose(key.source_key)}
                on:mousemove={() => (active = index)}
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
