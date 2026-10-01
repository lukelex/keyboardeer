<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { runtimeHealthDetail, runtimeHealthLabel } from "../../domain/devices";
  import { humanize } from "../../domain/text";
  import { hasDesktopBinding } from "../../platform/bindings";
  import { useApp } from "../../state/context";

  // Mappings the manager runs from KMonad files the person maintains.
  const { connection, configurations, sources } = useApp();
  const adoption = $derived(connection.capability("external_configuration_adoption"));
</script>

<section class="external-configurations" aria-labelledby="external-title">
  <div class="external-heading">
    <div>
      <p class="eyebrow">MANAGER-SUPERVISED</p>
      <h2 id="external-title">External configurations</h2>
    </div>
    <span class="build-label">MANAGER-OWNED</span>
  </div>
  <p>
    The manager runs these from KMonad files you maintain yourself. You can
    view their source, and adopt one when the manager can represent it without
    loss.
  </p>
  <div class="external-configuration-list">
    {#each connection.externalConfigurations as configuration (configuration.id)}
      {@const lastOperation = connection.operationFor(configuration)}
      <article class="external-configuration">
        <div class="external-configuration-heading">
          <h3>{configuration.name || "Unnamed external configuration"}</h3>
          <span>{runtimeHealthLabel(configuration)}</span>
        </div>
        <p>{runtimeHealthDetail(configuration)}</p>
        {#if lastOperation}<small
            >Latest manager operation: {humanize(lastOperation.state)}
            — {lastOperation.reason}</small
          >{/if}
        <div class="external-configuration-actions">
          <Button
            variant="secondary"
            type="button"
            onclick={() => sources.showExternal(configuration)}>View source</Button
          >
          <Button
            variant="secondary"
            type="button"
            onclick={() => configurations.adopt(configuration)}
            disabled={configurations.adoptingID !== "" ||
              !adoption.available ||
              !hasDesktopBinding("AdoptConfiguration")}
            title={adoption.available
              ? "Hand this configuration to KeyboarDeer's managed lifecycle"
              : adoption.reason}
            >{configurations.adoptingID === configuration.id
              ? "Adopting…"
              : "Adopt as managed"}</Button
          >
        </div>
      </article>
    {/each}
  </div>
</section>
