import type { ActionContext } from "../../../domain/actionDefaults";
import type { DraftEditor } from "../../../state/editor.svelte";

/** The key and layer a complex-action dialog was opened for. */
export function actionContext(editor: DraftEditor): ActionContext {
  return {
    keymap: editor.keymap!,
    catalog: editor.catalog,
    layerID: editor.layerID,
    sourceKey: editor.sourceKey,
  };
}
