// The keyboard always gets its natural height first. The grouped palette is
// used only when the remaining window height fits it (its CSS height is
// capped to the same value); otherwise the compact, category-tabbed strip
// is shown. These are the full-mode CSS dimensions.
const compactPaletteHeight = 720;
const editorChromeHeight = 110;
const keyboardRowHeight = 47;
const keyboardFrameHeight = 123;
const fullPaletteMinHeight = 380;
const fullPaletteViewportShare = 0.45;

export function usesCompactPalette(viewportHeight: number, rowCount: number) {
  if (viewportHeight <= 0) return false;
  const keyboardHeight = rowCount * keyboardRowHeight + keyboardFrameHeight;
  return (
    viewportHeight <= compactPaletteHeight ||
    viewportHeight - editorChromeHeight - keyboardHeight <
      Math.max(fullPaletteMinHeight, viewportHeight * fullPaletteViewportShare)
  );
}
