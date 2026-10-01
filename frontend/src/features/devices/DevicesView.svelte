<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { useApp } from "../../state/context";
  import DeviceCard from "./DeviceCard.svelte";
  import ExternalConfigurations from "./ExternalConfigurations.svelte";
  import FirstRunCard from "./FirstRunCard.svelte";
  import IdentifyIcon from "./IdentifyIcon.svelte";
  import ManagerNotice from "./ManagerNotice.svelte";
  import ProfileFileNotices from "./ProfileFileNotices.svelte";

  const app = useApp();
  const { connection, library } = app;

  // Keyboards that already have a profile or a managed mapping come first.
  const setUp = $derived(
    connection.inputDevices.filter(
      (device) =>
        library.hasProfileFor(device.id) ||
        connection.hasManagedConfiguration(device.id),
    ),
  );
  const notSetUp = $derived(
    connection.inputDevices.filter((device) => !setUp.includes(device)),
  );
  const showFirstRun = $derived(
    app.firstRunOpen &&
      connection.live &&
      connection.canShowDevices &&
      connection.inputDevices.length > 0 &&
      library.profiles.length === 0 &&
      !library.storeProblem,
  );
</script>

<section aria-labelledby="keyboards-title">
  <div class="page-heading">
    <div>
      <p class="eyebrow">YOUR WORKSPACE</p>
      <h1 id="keyboards-title">Make yourself at home.</h1>
      <p>Your keyboards, ready for a little personal touch.</p>
    </div>
  </div>

  <ManagerNotice />
  {#if showFirstRun}<FirstRunCard />{/if}
  <ProfileFileNotices />

  <div class="list-caption">
    <span>YOUR KEYBOARDS</span><span
      >{connection.canShowDevices
        ? `${connection.inputDevices.length} known`
        : "Waiting for manager capability"}</span
    >
  </div>
  {#if connection.canShowDevices && connection.inputDevices.length === 0}
    <section class="empty-state">
      <span aria-hidden="true">⌨</span>
      <h2>A little quiet here.</h2>
      <p>
        The manager has not reported a keyboard yet. Connect one, then refresh.
      </p>
    </section>
  {:else if connection.canShowDevices}
    <div class="device-list">
      {#each setUp as device (device.id)}
        <DeviceCard {device} />
      {/each}
      {#if notSetUp.length}
        <div class="device-list-section">Not set up yet</div>
        {#each notSetUp as device (device.id)}
          <DeviceCard {device} />
        {/each}
      {/if}
    </div>
  {:else}
    <section class="device-list disabled-list" aria-label="Unavailable keyboard inventory">
      <article class="device-card">
        <div class="device-copy">
          <div class="device-title">
            <h2>Keyboard inventory</h2>
            <span class="availability">Unavailable</span>
          </div>
          <p>
            Keyboard actions will become available when the manager reports the
            required capability.
          </p>
        </div>
        <div class="device-actions">
          <Button
            variant="text"
            class="identify-trigger"
            aria-label="Identify"
            title="Device discovery is unavailable"
            disabled><IdentifyIcon /></Button
          ><Button variant="primary" disabled>Set up</Button>
        </div>
      </article>
    </section>
  {/if}
  {#if connection.externalConfigurations.length}
    <ExternalConfigurations />
  {/if}
</section>
