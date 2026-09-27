// Talks to the Pages Functions in functions/api/, which keep saved snowflakes
// in Cloudflare D1.
import { parseRecording, type Recording } from "./timeline";

/** The address that opens a saved snowflake. */
export function shareUrl(id: string) {
  return `${location.origin}${location.pathname}?s=${encodeURIComponent(id)}`;
}

export async function saveSnowflake(recording: Recording): Promise<{ id: string } | { error: string }> {
  try {
    const res = await fetch("/api/snowflakes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recording),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (res.ok && body?.id) return { id: body.id };
    return { error: body?.error ?? `the server said ${res.status}` };
  } catch {
    return { error: "no connection" };
  }
}

/** The saved recording, or null when there is none by that id (or it can't be read). */
export async function loadSnowflake(id: string): Promise<Recording | null> {
  try {
    const res = await fetch(`/api/snowflakes/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { recording?: unknown };
    const recording = parseRecording(body.recording);
    return typeof recording === "string" ? null : recording;
  } catch {
    return null;
  }
}
