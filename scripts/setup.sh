#!/usr/bin/env bash
# The published codebase: the codebase at its pinned commit, dependencies installed, baseline test results recorded.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
config="$here/config/codebase.json"
field() { node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]])" "$config" "$1"; }
commit="$(field commit)"
repository="$(field repository)"
published="$here/work/published"

if [ ! -d "$published/.git" ]; then
	git clone -q "$repository" "$published"
fi

git -C "$published" checkout -q "$commit"
git -C "$published" diff --quiet || { echo "work/published has local changes; reset it first" >&2; exit 1; }

# Dependencies live in work/deps so every copy of the code shares them through a symlink.
deps="$here/work/deps/node_modules"
if [ ! -d "$deps" ]; then
	(cd "$published" && npm install --ignore-scripts --no-audit --no-fund >/dev/null)
	mkdir -p "$here/work/deps"
	mv "$published/node_modules" "$deps"
fi
[ -L "$published/node_modules" ] || ln -s ../deps/node_modules "$published/node_modules"

node "$here/scripts/run-tests.mjs" published
