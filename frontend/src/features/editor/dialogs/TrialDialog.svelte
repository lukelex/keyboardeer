<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import Dialog from "../../../components/Dialog.svelte";
  import { useApp } from "../../../state/context";

  // Confirms a just-applied mapping; closing it any other way than Keep
  // switches the bindings off.
  const { trial } = useApp();
</script>

<Dialog
  alert
  labelledby="trial-title"
  describedby="trial-message"
  class="behavior-dialog confirm-dialog trial-dialog"
  backdropClass="behavior-dialog-backdrop confirm-backdrop"
  onclose={() => trial.turnOff()}
>
  <h2 id="trial-title">Keep the new mapping?</h2>
  <p id="trial-message" class="dialog-intro">
    Try typing with it now. Unless you keep it, its bindings switch off in
    <strong class="trial-countdown">{trial.remainingSeconds} s</strong> and the
    keyboard types normally again.
  </p>
  <div class="behavior-form-actions">
    <Button variant="secondary" type="button" onclick={() => trial.turnOff()}
      >Turn off now</Button
    >
    <Button variant="primary" type="button" onclick={() => trial.keep()}
      >Keep mapping</Button
    >
  </div>
</Dialog>
