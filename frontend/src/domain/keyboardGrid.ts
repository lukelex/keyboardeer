import type { GeometryTemplate } from "../platform/desktop";

export type Direction = "left" | "right" | "up" | "down";

interface PlacedKey {
  sourceKey: string;
  row: number;
  /** Horizontal centre in key units. */
  center: number;
}

/**
 * Spatial neighbours on a physical layout, for moving the selection with
 * the arrow keys. A source key that appears twice (a split board's two
 * spaces) moves from its first position.
 */
export class KeyboardGrid {
  readonly #rows: PlacedKey[][];

  constructor(geometry: GeometryTemplate) {
    const rowNumbers = [...new Set(geometry.keys.map((key) => key.row))].sort(
      (left, right) => left - right,
    );
    this.#rows = rowNumbers.map((row, rowIndex) => {
      let x = 0;
      return geometry.keys
        .filter((key) => key.row === row)
        .map((key) => {
          x += key.gap_before ?? 0;
          const placed = {
            sourceKey: key.source_key,
            row: rowIndex,
            center: x + key.width / 2,
          };
          x += key.width;
          return placed;
        });
    });
  }

  /** The key next to `sourceKey`, or undefined at the layout's edge. */
  neighbor(sourceKey: string, direction: Direction): string | undefined {
    const from = this.#find(sourceKey);
    if (!from) return undefined;
    const row = this.#rows[from.row];
    if (direction === "left" || direction === "right") {
      const index = row.indexOf(from) + (direction === "right" ? 1 : -1);
      return row[index]?.sourceKey;
    }
    const target = this.#rows[from.row + (direction === "down" ? 1 : -1)];
    if (!target?.length) return undefined;
    return target.reduce((closest, candidate) =>
      Math.abs(candidate.center - from.center) <
      Math.abs(closest.center - from.center)
        ? candidate
        : closest,
    ).sourceKey;
  }

  #find(sourceKey: string): PlacedKey | undefined {
    for (const row of this.#rows) {
      const key = row.find((candidate) => candidate.sourceKey === sourceKey);
      if (key) return key;
    }
    return undefined;
  }
}
