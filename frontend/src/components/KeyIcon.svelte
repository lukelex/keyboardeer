<script context="module" lang="ts">
  // Monochrome 24 × 24 stroke icons for palette keys whose names are long or
  // whose usual glyphs (emoji, rare Unicode symbols) render inconsistently.
  const speaker = "M4 10h3l4-4v12l-4-4H4Z";
  const sun = "M10 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z";
  const sunRays =
    "M10 4.5v1.5M10 18v1.5M4.5 12H3M17 12h-1.5M6.1 8.1 5 7M15 17l-1.1-1.1M6.1 15.9 5 17M15 7l-1.1 1.1";
  const keyboard = "M3 13h18v6H3ZM6 16h.01M9 16h.01M12 16h.01M15 16h.01M18 16h.01";
  const light = "M12 4.5v3M7 6l1.5 2.2M17 6l-1.5 2.2";
  const plus = "M19 3v4M17 5h4";
  const minus = "M17 5h4";
  export const keyIconPaths: Record<string, string[]> = {
    bspc: ["M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6Z", "M12 10l4 4M16 10l-4 4"],
    del: ["M15 6H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10l5-6Z", "M8 10l4 4M12 10l-4 4"],
    tab: ["M4 12h13M13 8l4 4-4 4M20 6v12"],
    ret: ["M19 6v5a3 3 0 0 1-3 3H6M10 10l-4 4 4 4"],
    spc: ["M5 10v4h14v-4"],
    left: ["M19 12H5M11 6l-6 6 6 6"],
    rght: ["M5 12h14M13 6l6 6-6 6"],
    up: ["M12 19V5M6 11l6-6 6 6"],
    down: ["M12 5v14M6 13l6 6 6-6"],
    prnt: ["M4 8h16v11H4ZM9 8l1.5-2.5h3L15 8", "M12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
    mute: [speaker, "M15 10l4 4M19 10l-4 4"],
    voldwn: [speaker, "M15 9.5a3.5 3.5 0 0 1 0 5"],
    volu: [speaker, "M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"],
    pp: ["M4 6l8 6-8 6Z", "M15 6v12M19 6v12"],
    next: ["M5 6l9 6-9 6Z", "M18 6v12"],
    prev: ["M19 6l-9 6 9 6Z", "M6 6v12"],
    stopcd: ["M7 7h10v10H7Z"],
    eject: ["M5 14h14l-7-8Z", "M5 18h14"],
    brup: [sun, sunRays, plus],
    brdown: [sun, sunRays, minus],
    kbdillumtoggle: [keyboard, light],
    blup: [keyboard, light, plus],
    bldn: [keyboard, "M12 5v3", minus],
  };
</script>

<script lang="ts">
  export let name: string;
</script>

<svg class="key-icon" viewBox="0 0 24 24" aria-hidden="true" data-icon={name}>
  {#each keyIconPaths[name] ?? [] as path}<path d={path} />{/each}
</svg>
