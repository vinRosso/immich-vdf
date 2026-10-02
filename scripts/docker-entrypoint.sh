#!/bin/sh
# Docker creates a missing bind mount as root. Start as root, give /data to
# PUID:PGID, then run the server as that user with no Linux capabilities.
set -eu

puid=${PUID:-1000}
pgid=${PGID:-100}

case $puid in
  ''|*[!0-9]*) echo "immich-vdf: PUID must be a numeric user id" >&2; exit 1 ;;
esac
case $pgid in
  ''|*[!0-9]*) echo "immich-vdf: PGID must be a numeric group id" >&2; exit 1 ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /data
  mode=$(stat -c '%a' /data)
  owner=$(stat -c '%u:%g' /data)
  if [ "$owner" != "$puid:$pgid" ]; then
    chown "$puid:$pgid" /data
    echo "immich-vdf: /data is owned by ${puid}:${pgid}"
  fi
  # 700: only the owner can read the session secret and the Immich API key.
  # The image leaves /data at 1777, and Docker creates a new bind mount at 755.
  # A mode that is already limited to the owner, such as 700 or 500, stays as it is.
  bits=$mode
  while [ "${#bits}" -gt 3 ]; do
    bits=${bits#?}
  done
  group=${bits#?}
  group=${group%?}
  others=${bits#"${bits%?}"}
  if [ "$group" != "0" ] || [ "$others" != "0" ]; then
    chmod 700 /data
  fi
  # PUID 0 still reaches this drop, so the server does not keep root's capabilities.
  exec setpriv \
    --reuid="$puid" \
    --regid="$pgid" \
    --clear-groups \
    --inh-caps=-all \
    --ambient-caps=-all \
    --bounding-set=-all \
    -- "$@"
fi

if [ ! -w /data ]; then
  echo "immich-vdf: /data is not writable by uid $(id -u). Remove user: from Compose so startup can give /data to PUID:PGID." >&2
  exit 1
fi

exec "$@"
