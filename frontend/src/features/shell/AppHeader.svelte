<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { humanize } from "../../domain/text";
  import { useApp } from "../../state/context";

  const { connection, preferences } = useApp();
  const status = $derived(connection.workspace.status);
  const stale = $derived(!!connection.workspace.stale);
</script>

<header class="app-header">
  <div class="brand">
    <img src="/appicon.png" alt="" width="44" height="44" />
    <span
      ><strong>KeyboarDeer</strong><small>A LITTLE WILD. A LITTLE WIRED.</small
      ></span
    >
  </div>
  <div class="header-actions">
    <Button
      variant="icon"
      class="preferences-button"
      aria-label="Preferences"
      title="Preferences"
      onclick={() => preferences.show()}
      ><svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path
          d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-1.3-3.1h-.2a1.8 1.8 0 1 1 0-3.6h.2a1.8 1.8 0 0 0 1.3-3.1l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3.1-1.3v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.8 1.8 0 0 0 3.1 1.3l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 1.3 3.1h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-1.3 3.1Z"
        /></svg
      ></Button
    >
    <span
      class={[
        "connection-status",
        status.state === "ready" && "ready",
        (status.state !== "ready" || stale) && "attention",
      ]}
    >
      <i></i>{stale
        ? "Manager state stale"
        : status.state === "ready"
          ? "Manager ready"
          : humanize(status.state)}
    </span>
  </div>
</header>
