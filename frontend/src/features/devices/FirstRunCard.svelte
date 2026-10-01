<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { useApp } from "../../state/context";

  const app = useApp();
</script>

<section class="first-run-card" aria-labelledby="first-run-title">
  <div class="first-run-icon" aria-hidden="true">⌨</div>
  <div>
    <p class="eyebrow">WELCOME TO KEYBOARDEER</p>
    <h2 id="first-run-title">Start with a local keyboard draft</h2>
    <p>
      Choose a keyboard, confirm its verified physical layout, then edit a
      draft. Nothing changes on the keyboard until you review and apply it.
      Applied mappings are run by the keyboard manager service, so they keep
      working when KeyboarDeer is closed.
    </p>
    <ol>
      <li>Choose a connected keyboard.</li>
      <li>Detect or select its verified layout.</li>
      <li>Map keys, preview the result, and apply when ready.</li>
    </ol>
    <div class="first-run-actions">
      <Button variant="primary" type="button" onclick={() => app.startFirstRun()}
        >Set up a keyboard</Button
      >
      <Button variant="link" type="button" onclick={() => app.dismissFirstRun()}
        >Skip for now</Button
      >
    </div>
  </div>
</section>
