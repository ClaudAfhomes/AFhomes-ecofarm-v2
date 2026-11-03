#!/usr/bin/env bash
# AFHomes release deployment helper for the existing DigitalOcean Droplet.
# Source of truth: immutable GitHub release/vX.Y branches.
# Run as afhomes-deploy: afhomes-release release/v2.1 | afhomes-release rollback
set -Eeuo pipefail
umask 027

repo="$HOME/afhomes-src"
frontend_env="$HOME/.config/afhomes/frontend.env"
api_root="/opt/afhomes/api"
site_root="/srv/afhomes"
api_current="$api_root/current"
site_current="$site_root/current"
api_previous="$api_root/previous"
site_previous="$site_root/previous"
work=""

cleanup() {
  if [[ -n "$work" && -d "$work" ]]; then rm -rf -- "$work"; fi
}
trap cleanup EXIT

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Atomic replacement of a symlink. Does not delete the pointed-to release.
point() {
  local target="$1" link="$2" temp="${link}.new.$$"
  sudo ln -s "$target" "$temp" && sudo mv -Tf "$temp" "$link"
}

ready() {
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 5 http://127.0.0.1:3084/ready >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

site_ready() {
  curl -fsSI --max-time 15 https://portal.afhomes.com.ph/ >/dev/null &&
    curl -fsSI --max-time 15 https://portal.afhomes.com.ph/admin/ >/dev/null
}

[[ "$(id -un)" == "afhomes-deploy" ]] || fail 'Run as afhomes-deploy, not root.'
[[ -d "$repo/.git" ]] || fail "Missing Git checkout at $repo"
[[ -n "${1:-}" && $# -eq 1 ]] || fail 'Usage: afhomes-release release/v2.1 OR afhomes-release rollback'

exec 9>"$HOME/.afhomes-release.lock"
flock -n 9 || fail 'Another AFHomes deployment/rollback is running.'

old_api="$(readlink -f "$api_current")"
old_site="$(readlink -f "$site_current")"
[[ -f "$old_api/server.js" && -f "$old_site/index.html" && -f "$old_site/admin/index.html" ]] ||
  fail 'Current API or website release is missing. No changes were made.'

if [[ "$1" == rollback ]]; then
  target_api="$(readlink -f "$api_previous" 2>/dev/null || true)"
  target_site="$(readlink -f "$site_previous" 2>/dev/null || true)"
  [[ -f "$target_api/server.js" && -f "$target_site/index.html" && -f "$target_site/admin/index.html" ]] ||
    fail 'No complete previous deployment is saved yet.'
  printf 'Rollback to API: %s\nRollback to web: %s\n' "$target_api" "$target_site"
  if point "$target_api" "$api_current" && point "$target_site" "$site_current" &&
     sudo systemctl restart afhomes-api && ready && site_ready; then
    point "$old_api" "$api_previous"
    point "$old_site" "$site_previous"
    echo 'ROLLBACK SUCCESS: Previous API and frontend are live.'
    exit 0
  fi
  echo 'Rollback health check failed; attempting to restore the original deployment.' >&2
  point "$old_api" "$api_current"
  point "$old_site" "$site_current"
  sudo systemctl restart afhomes-api || true
  fail 'Rollback failed. Original release pointers restored; inspect logs.'
fi

branch="$1"
[[ "$branch" =~ ^release/v[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] ||
  fail 'Only release/vX.Y or release/vX.Y.Z branch names are accepted.'
[[ -f "$frontend_env" ]] || fail "Missing frontend build environment: $frontend_env"

printf 'Fetching %s from GitHub (no branch checkout on the Droplet)...\n' "$branch"
git -C "$repo" fetch --quiet origin "refs/heads/$branch"
sha="$(git -C "$repo" rev-parse 'FETCH_HEAD^{commit}')"
short="${sha:0:7}"
release_name="${branch//\//-}-$short-$(date -u +%Y%m%dT%H%M%SZ)"
api_release="$api_root/releases/$release_name"
site_release="$site_root/releases/$release_name"

printf 'Release: %s\nGitHub commit: %s\n' "$branch" "$sha"
work="$(mktemp -d "$HOME/afhomes-build.XXXXXXXX")"
git -C "$repo" archive "$sha" | tar -xf - -C "$work"
cp -- "$frontend_env" "$work/.env.production"
cd "$work"

# Stop before cutover if install or any component build fails.
pnpm install --frozen-lockfile
NODE_OPTIONS="--max-old-space-size=1536" pnpm exec turbo run build --concurrency=1
# The API package uses build:artifact, not build; build it explicitly.
pnpm --filter api build:artifact

[[ -s api/dist/server.js && -s apps/web/dist/index.html && -s apps/admin/dist/index.html ]] ||
  fail 'API/web/admin build output incomplete; production unchanged.'

printf 'Installing build files into new immutable release directories...\n'
sudo install -d -m 0755 -o afhomes-deploy -g afhomes-deploy "$api_release"
sudo install -d -m 0755 -o afhomes-deploy -g afhomes-deploy "$site_release"
cp -a api/dist/. "$api_release/"
cp -a apps/web/dist/. "$site_release/"
mkdir -p "$site_release/admin"
cp -a apps/admin/dist/. "$site_release/admin/"

printf 'Activating new API + website...\n'
if point "$api_release" "$api_current" && point "$site_release" "$site_current" &&
   sudo systemctl restart afhomes-api && ready && site_ready; then
  point "$old_api" "$api_previous"
  point "$old_site" "$site_previous"
  echo "DEPLOY SUCCESS: $branch @ $short"
  echo 'Rollback command: afhomes-release rollback'
else
  echo 'Deployment health check failed; restoring previous API + website...' >&2
  point "$old_api" "$api_current"
  point "$old_site" "$site_current"
  sudo systemctl restart afhomes-api || true
  fail 'New release rejected. Previous release pointers restored; inspect logs.'
fi
