#!/usr/bin/env bash
set -euo pipefail
umask 077
destination=${1:?Informe o destino local do backup.}
temporary=$(mktemp "${destination}.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
host=${EXPAND_SSH_HOST:-n4050}
directory=${EXPAND_REMOTE_DIR:-/opt/expand}
if [[ ! $host =~ ^[[:alnum:]_][[:alnum:]_.@-]*$ || ! $directory =~ ^/[[:alnum:]_./-]+$ ]]; then
  echo 'Informe um alias SSH e um diretório absoluto válidos.' >&2
  exit 1
fi
ssh -F "$HOME/.ssh/config" -o BatchMode=yes "$host" "cd '$directory'"';
  docker compose exec -T expand sh -ec '\''
    snapshot=$(mktemp)
    trap "rm -f \"$snapshot\"" EXIT
    node server/admin.js backup "$snapshot"
    cat "$snapshot"
  '\''
' > "$temporary"
python3 - "$temporary" <<'PY'
import pathlib
import sqlite3
import sys

path = pathlib.Path(sys.argv[1]).resolve()
with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as snapshot:
    assert snapshot.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    snapshot.execute("SELECT count(*) FROM changes").fetchone()
PY
mv -n -- "$temporary" "$destination"
if [[ -e $temporary ]]; then
  echo "O destino já existe." >&2
  exit 1
fi
