<script lang="ts">
  import Dialog from "../../../components/Dialog.svelte";
  import { useApp } from "../../../state/context";

  const app = useApp();
  // `combo` keys are pressed together (Ctrl + Z); others are alternatives.
  interface Shortcut {
    keys: string[];
    action: string;
    combo?: boolean;
  }
  const groups: { heading: string; shortcuts: Shortcut[] }[] = [
    {
      heading: "With no key selected",
      shortcuts: [{ keys: ["Any key"], action: "Select that key on the keyboard" },
        {
          keys: ["Ctrl", "Click"],
          action: "Add a key to the selection, or remove it",
          combo: true,
        },],
    },
    {
      heading: "With a key selected",
      shortcuts: [
        { keys: ["←", "→", "↑", "↓"], action: "Select the neighbouring key" },
        { keys: ["Type a letter"], action: "Search the palette for an output key" },
        { keys: ["Delete"], action: "Restore the key's original behavior" },
        { keys: ["Esc"], action: "Deselect the key" },
      ],
    },
    {
      heading: "Anywhere in the editor",
      shortcuts: [
        { keys: ["Ctrl", "Z"], action: "Undo", combo: true },
        { keys: ["Ctrl", "Shift", "Z"], action: "Redo", combo: true },
        { keys: ["?"], action: "Show these shortcuts" },
      ],
    },
  ];
</script>

<Dialog
  labelledby="shortcuts-title"
  class="behavior-dialog shortcuts-dialog"
  closeLabel="Close keyboard shortcuts"
  onclose={() => (app.shortcutsOpen = false)}
>
  <p class="eyebrow">EDIT FROM THE KEYBOARD</p>
  <h2 id="shortcuts-title">Keyboard shortcuts</h2>
  {#each groups as group (group.heading)}
    <section class="shortcut-group" aria-labelledby={`shortcuts-${group.heading}`}>
      <h3 id={`shortcuts-${group.heading}`}>{group.heading}</h3>
      <dl>
        {#each group.shortcuts as shortcut (shortcut.action)}
          <div>
            <dt>
              {#each shortcut.keys as key, index (key)}{#if index && shortcut.combo}<span
                    aria-hidden="true">+</span
                  >{/if}<kbd>{key}</kbd>{/each}
            </dt>
            <dd>{shortcut.action}</dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}
</Dialog>
