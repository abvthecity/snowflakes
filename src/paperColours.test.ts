import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PAPER_COLOUR, PAPER_COLOURS, paperColour } from "./paperColours.ts";

test("white is the default, and unknown ids fall back to it", () => {
  assert.equal(DEFAULT_PAPER_COLOUR.id, "white");
  assert.equal(paperColour(undefined).id, "white");
  assert.equal(paperColour("tartan").id, "white");
  assert.equal(paperColour("mint").name, "Mint");
});

test("every paper has its own id and a colour", () => {
  assert.equal(new Set(PAPER_COLOURS.map((c) => c.id)).size, PAPER_COLOURS.length);
  for (const c of PAPER_COLOURS) assert.match(c.hex, /^#[0-9a-f]{6}$/);
});
