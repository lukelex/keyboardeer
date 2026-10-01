<script lang="ts">
  import Button from "../../components/Button.svelte";
  import Dialog from "../../components/Dialog.svelte";
  import { identifyStatusText } from "../../domain/operations";
  import { humanize } from "../../domain/text";
  import { useApp } from "../../state/context";

  const app = useApp();
  const { identify, connection, library } = app;
  const device = $derived(identify.device!);
  const operation = $derived(identify.operation);

  function configure() {
    identify.close();
    app.openDevice(device);
  }
</script>

<Dialog
  labelledby="identify-title"
  class="identify-dialog"
  backdropClass="identify-dialog-backdrop"
  closeClass="identify-close"
  closeLabel="Close keyboard identification"
  closeTitle="Close identification"
  onclose={() => identify.close()}
>
  <div class="identify-dialog-heading">
    <p class="eyebrow">LET’S FIND YOUR KEYBOARD</p>
    <h2 id="identify-title">Is this the one?</h2>
  </div>
  <article class="identify-card">
    <div class={["identify-art", identify.found && "found"]} aria-hidden="true">
      <div class="orbit first"></div>
      <div class="orbit second"></div>
      <span>{identify.found ? "✓" : "⌨"}</span>
    </div>
    <div class="identify-copy">
      <p class="eyebrow">{device.display_name}</p>
      <h2>
        {identify.found
          ? "Found it!"
          : operation
            ? humanize(operation.state)
            : "Ready when you are."}
      </h2>
      <p>
        {identify.found
          ? `That key press came from ${device.display_name || "this keyboard"}.`
          : (operation?.reason ??
            `Start, then press any key on this keyboard within ${identify.timeoutMS / 1000} seconds. Only this keyboard's mapping pauses briefly.`)}
      </p>
      <div class="operation-status">
        <i></i><span>{identifyStatusText(operation)}</span>
      </div>
      {#if operation}
        <details class="technical-details">
          <summary>Technical details</summary>
          <small>{operation.reason_code} · operation {operation.id}</small>
        </details>
      {/if}
      {#if !identify.found}
        <div class="identify-timing">
          <label for="identify-timeout">Session length</label>
          <select
            id="identify-timeout"
            bind:value={identify.timeoutMS}
            disabled={identify.running}
          >
            <option value={5_000}>5 seconds</option>
            <option value={15_000}>15 seconds</option>
            <option value={30_000}>30 seconds</option>
          </select>
          {#if identify.running}
            <strong aria-live="polite">{identify.remainingSeconds}s remaining</strong>
          {/if}
        </div>
      {/if}
      <div class="identify-actions">
        {#if identify.found}
          <Button variant="primary" type="button" onclick={configure}
            >{library.preferredFor(device) ? "Edit draft" : "Set up this keyboard"}</Button
          >
        {/if}
        <Button
          variant={identify.found ? "text" : "primary"}
          onclick={() => identify.start()}
          disabled={!connection.canIdentify || identify.busy || identify.running}
          >{identify.busy
            ? "Working…"
            : identify.finished
              ? "Try again"
              : `Start ${identify.timeoutMS / 1000}-second identification`}</Button
        ><Button
          variant="text"
          onclick={() => identify.cancel()}
          disabled={!identify.running || identify.busy}>Cancel</Button
        >
      </div>
    </div>
  </article>
  {#if identify.notice}<p class="inline-feedback" role="status">
      {identify.notice}
    </p>{/if}
  <section class="quiet-tip">
    <strong>A brief pause, just for this keyboard.</strong>
    <p>
      The manager owns the session and restores the selected mapping when it
      ends. Other keyboards continue independently.
    </p>
  </section>
</Dialog>
