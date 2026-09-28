// GET /api/snowflakes/<id>  →  { id, createdAt, recording }
import { json, type Handler } from "../../../server/d1.ts";

export const onRequestGet: Handler = async ({ env, params }) => {
  const id = String(params.id);
  if (!/^[A-Za-z0-9]{1,32}$/.test(id)) return json({ error: "not found" }, 404);
  const row = await env.DB.prepare("SELECT id, created_at, recording FROM snowflakes WHERE id = ?")
    .bind(id)
    .first<{ id: string; created_at: number; recording: string }>();
  if (!row) return json({ error: "not found" }, 404);
  // A saved snowflake never changes, so browsers and Cloudflare may keep it.
  return json({ id: row.id, createdAt: row.created_at, recording: JSON.parse(row.recording) }, 200, {
    "cache-control": "public, max-age=31536000, immutable",
  });
};
