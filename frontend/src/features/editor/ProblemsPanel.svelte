<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { count } from "../../domain/text";
  import { diagnosticResourceLabel } from "../../domain/validation";
  import type { MappedAssignmentIssue } from "../../domain/validationRecovery";
  import { useApp } from "../../state/context";

  // Manager diagnostics for an invalid or blocked draft, above the keyboard
  // so they never cover keys.
  const { editor, library } = useApp();
  const preview = $derived(editor.currentPreview);
  const diagnostics = $derived(preview?.validation.diagnostics ?? []);

  // Selects an exactly mapped key and brings it into view.
  function show(issue: MappedAssignmentIssue) {
    editor.select(issue.layerID, issue.sourceKey);
    requestAnimationFrame(() => {
      const key = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-issue-key]"),
      ).find(
        (candidate) =>
          candidate.dataset.layerId === issue.layerID &&
          candidate.dataset.sourceKey === issue.sourceKey,
      );
      key?.scrollIntoView({ block: "center", inline: "nearest" });
      key?.focus();
    });
  }
</script>

{#if preview && preview.validation.outcome !== "valid"}
  {@const blocked = preview.validation.outcome === "blocked"}
  <section
    class={["preview-message", blocked && "blocked"]}
    aria-labelledby="problems-title"
  >
    <div class="problems-heading">
      <strong id="problems-title"
        >{blocked
          ? "Validation blocked"
          : `${count(diagnostics.length || 1, "problem")} in this draft`}</strong
      >
      <Button
        variant="text"
        type="button"
        aria-expanded={!editor.problemsHidden}
        aria-controls="problems-body"
        onclick={() => (editor.problemsHidden = !editor.problemsHidden)}
        >{editor.problemsHidden ? "Show details" : "Hide details"}</Button
      >
    </div>
    <div id="problems-body" hidden={editor.problemsHidden} aria-live="polite">
      <p>{preview.validation.reason}</p>
      {#if preview.validation.outcome === "rejected"}
        <p>
          {editor.mappedIssues.length === 0
            ? "Nothing was applied. The manager did not point to a specific key, so check the problem described below."
            : "Nothing was applied. The keys involved are marked on the keyboard; show or revert each one below."}
        </p>
      {:else if blocked}
        <p>
          This is not a problem with your keys: the manager or keyboard could
          not check the draft. You can keep editing while it recovers.
        </p>
      {/if}
      {#if diagnostics.length}
        <ul class="validation-diagnostics">
          {#each diagnostics as diagnostic (diagnostic.id)}
            {@const issue = editor.diagnosticIssue(diagnostic.id)}
            {@const recovery = issue ? editor.recoveryFor(issue) : null}
            <li>
              <strong>{diagnosticResourceLabel(diagnostic)}</strong>
              <span>{diagnostic.summary}</span>
              {#if diagnostic.remediation}<small>{diagnostic.remediation}</small>{/if}
              {#if issue}
                <div class="validation-issue-actions">
                  <Button variant="text" type="button" onclick={() => show(issue)}
                    >Show {editor.keymap?.layerName(issue.layerID)} · {issue.sourceKey}</Button
                  >
                  {#if recovery?.available}
                    <Button
                      variant="secondary"
                      type="button"
                      onclick={() => editor.revertIssue(diagnostic.id)}
                      disabled={library.busy || !!editor.profile?.apply_pending}
                      >Revert {issue.sourceKey}</Button
                    >
                  {/if}
                </div>
                {#if recovery?.reason}<small>{recovery.reason}</small>{/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
{/if}
