import type { PaletteCategory } from "../../domain/keyCatalog";

/** The palette's search and category, shared with editor shortcuts. */
export class PaletteState {
  search = $state("");
  category = $state<PaletteCategory>("all");
  /** The output key being looked up (hovered or focused in the palette). */
  inspecting = $state("");

  /** Starts a new search across every category. */
  startSearch(text: string) {
    this.search = text;
    this.category = "all";
  }
}
