<script lang="ts">
  import Button from "../../components/Button.svelte";
  import KeyboardPreview from "../../components/KeyboardPreview.svelte";
  import {
    deviceState,
    deviceStateSummary,
    isConfigurable,
    isConnected,
  } from "../../domain/devices";
  import { humanize } from "../../domain/text";
  import type { Device } from "../../platform/desktop";
  import { useApp } from "../../state/context";
  import BindingSwitch from "./BindingSwitch.svelte";
  import ConfigurationState from "./ConfigurationState.svelte";
  import IdentifyIcon from "./IdentifyIcon.svelte";

  let { device }: { device: Device } = $props();
  const app = useApp();
  const { connection, library, identify } = app;

  const state = $derived(deviceState(device));
  const connected = $derived(isConnected(device));
  const profile = $derived(library.preferredFor(device));
  const profileCount = $derived(library.forDevice(device.id).length);
  const geometry = $derived(library.geometryFor(device));
  const deviceConfigurations = $derived(connection.configurationsFor(device));
  const identification = $derived(connection.capability("device_identification"));
</script>

<article
  class={["device-card", !connected && "offline", state !== "connected" && "attention"]}
>
  {#if geometry}
    <div class="device-preview">
      <KeyboardPreview {geometry} />
    </div>
  {/if}
  <div class="device-copy">
    <div class="device-title">
      <h2>{device.display_name || "Unnamed keyboard"}</h2>
      <span class={["availability", connected && "connected"]}
        >{humanize(state)}</span
      >
    </div>
    <p>{device.reason || "The manager did not provide a display explanation."}</p>
    {#if state !== "connected"}
      <small class="device-state-summary">{deviceStateSummary(device)}</small>
    {/if}
    {#if profile}
      <small class="device-profile-summary"
        >Profile: {profile.name}{profileCount > 1
          ? ` · ${profileCount} profiles`
          : ""}</small
      >
    {/if}
    {#each deviceConfigurations as configuration (configuration.id)}
      <ConfigurationState {configuration} />
    {/each}
  </div>
  <div class="device-actions">
    <Button
      variant="text"
      class="identify-trigger"
      onclick={() => identify.show(device)}
      disabled={!connection.canIdentify || !isConfigurable(device) || !connected}
      aria-label="Identify"
      title={!connection.canIdentify
        ? identification.reason
        : !connected
          ? "Identification needs a connected keyboard."
          : "Identify this keyboard"}><IdentifyIcon /></Button
    >
    <Button
      variant="primary"
      onclick={() => app.openDevice(device)}
      disabled={!connection.live ||
        !isConfigurable(device) ||
        library.geometries.length === 0 ||
        !!library.storeProblem}
      title={library.storeProblem
        ? "Saved drafts must be recovered before editing."
        : library.geometries.length === 0
          ? "Loading verified keyboard geometries."
          : profile
            ? "Open this local keyboard draft"
            : "Create a local keyboard draft"}
      >{profile ? "Edit draft" : "Set up"}</Button
    >
    {#each deviceConfigurations.filter((item) => item.ownership === "managed") as configuration (configuration.id)}
      <BindingSwitch {configuration} disabled={!isConfigurable(device)} />
    {/each}
  </div>
</article>
