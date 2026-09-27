// POST /api/snowflakes  { v: 1, fold, paper: { id, params? }, events: [...] }  →  201 { id }
// Stores the recording of how a snowflake was made; the id opens it at /?s=<id>.
import { LIMITS, parseRecording } from "../../../src/timeline.ts";
import { json, type Handler } from "../../../server/d1.ts";

const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** 10 random characters: short enough to share, too many to guess (57^10). */
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const onRequestPost: Handler = async ({ request, env }) => {
  const text = await request.text();
  if (text.length > LIMITS.bytes) return json({ error: "that recording is too long to save" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "not JSON" }, 400);
  }
  const recording = parseRecording(body);
  if (typeof recording === "string") return json({ error: recording }, 400);

  const events = recording.events;
  const cuts = events.filter((e) => e.k === "cut").length;
  const id = newId();
  await env.DB.prepare("INSERT INTO snowflakes (id, created_at, duration_ms, cuts, paper, fold_method, recording) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, Date.now(), events[events.length - 1].t, cuts, recording.paper.id, recording.fold, JSON.stringify(recording))
    .run();
  return json({ id }, 201);
};
