<script lang="ts">
  import type { Configuration } from "../../platform/desktop";
  import { useApp } from "../../state/context";

  // Turns a managed mapping on or off. Turning it off is confirmed first;
  // declining puts the switch back.
  let {
    configuration,
    disabled = false,
  }: { configuration: Configuration; disabled?: boolean } = $props();
  const { connection, configurations } = useApp();
  const managed = $derived(connection.capability("managed_configurations"));
  const changing = $derived(configurations.busyID === configuration.id);

  async function toggle(event: Event & { currentTarget: HTMLInputElement }) {
    const control = event.currentTarget;
    const applied = await configurations.setEnabled(configuration, control.checked);
    if (!applied) control.checked = configuration.enabled;
  }
</script>

<label
  class={["binding-toggle", (!configuration.enabled || changing) && "disabled"]}
  title={!managed.available
    ? managed.reason
    : configuration.enabled
      ? "Uncheck to disable this keyboard’s managed bindings"
      : "Check to enable this keyboard’s managed bindings"}
>
  <input
    type="checkbox"
    role="switch"
    checked={configuration.enabled}
    disabled={!!configurations.busyID || !configurations.canManage || disabled}
    onchange={toggle}
    aria-label={`Enable bindings for ${configuration.name}`}
  />
  <span
    >{changing
      ? "Changing bindings…"
      : configuration.enabled
        ? "Bindings enabled"
        : "Bindings disabled"}</span
  >
</label>
