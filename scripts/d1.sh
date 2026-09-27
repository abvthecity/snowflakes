#!/usr/bin/env bash
# Gets the D1 databases ready for a deploy: creates `snowflakes` and
# `snowflakes-preview` if they don't exist, writes their ids into
# wrangler.toml, and applies migrations/ to the one this deploy uses.
#
#   scripts/d1.sh production|preview
#
# Needs CLOUDFLARE_API_TOKEN (with D1: Edit) and CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:?usage: d1.sh production|preview}"
wrangler=(pnpm dlx wrangler@4)

# Only the JSON array, in case pnpm prints anything around it.
d1_list() { "${wrangler[@]}" d1 list --json | sed -n '/^\[/,$p'; }

list="$(d1_list)" || {
  echo "::error::Could not list D1 databases. The Cloudflare API token needs the D1: Edit permission (Account > D1 > Edit)."
  exit 1
}

id_of() {
  jq -r --arg n "$1" '.[] | select(.name == $n) | .uuid' <<<"$list" | head -n1
}

for pair in "snowflakes:production-id" "snowflakes-preview:preview-id"; do
  name="${pair%%:*}"
  placeholder="${pair#*:}"
  id="$(id_of "$name")"
  if [ -z "$id" ]; then
    echo "Creating D1 database $name"
    "${wrangler[@]}" d1 create "$name" >/dev/null
    list="$(d1_list)"
    id="$(id_of "$name")"
  fi
  [ -n "$id" ] || { echo "::error::No id for D1 database $name"; exit 1; }
  echo "D1 $name: $id"
  sed -i "s/database_id = \"$placeholder\"/database_id = \"$id\"/" wrangler.toml
done

if [ "$target" = preview ]; then
  "${wrangler[@]}" d1 migrations apply DB --remote --env preview
else
  "${wrangler[@]}" d1 migrations apply DB --remote
fi
