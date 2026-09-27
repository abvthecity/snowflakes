// The papers to cut from: white, and a few pastels. Each keeps a stable `id`,
// so a saved snowflake can record which one it was cut from.

export interface PaperColour {
  id: "white" | "blush" | "butter" | "mint" | "sky" | "lilac";
  name: string;
  /** The sheet's base colour, in sRGB, before the fibres and lighting mottle it. */
  hex: string;
}

export const PAPER_COLOURS: readonly PaperColour[] = [
  { id: "white", name: "White", hex: "#fcfcfa" },
  { id: "blush", name: "Blush", hex: "#f7d3da" },
  { id: "butter", name: "Butter", hex: "#f6e7b4" },
  { id: "mint", name: "Mint", hex: "#c9eacf" },
  { id: "sky", name: "Sky", hex: "#c8dff2" },
  { id: "lilac", name: "Lilac", hex: "#ddd1f1" },
];

export const DEFAULT_PAPER_COLOUR = PAPER_COLOURS[0];

/** The paper with this id, or white for anything unknown. */
export function paperColour(id: string | null | undefined): PaperColour {
  return PAPER_COLOURS.find((c) => c.id === id) ?? DEFAULT_PAPER_COLOUR;
}
