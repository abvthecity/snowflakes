// Just enough of the Workers runtime types for these functions, so the repo
// doesn't need @cloudflare/workers-types for three queries.
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface Env {
  /** The snowflakes database (see wrangler.toml and migrations/). */
  DB: { prepare(sql: string): D1Statement };
}
export type Handler = (context: { request: Request; env: Env; params: Record<string, string | string[]> }) => Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
