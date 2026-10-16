#!/usr/bin/env bash
# The published codebase: the codebase at its pinned commit, dependencies installed, compiled, pre-edit codebase
# verification suite results recorded.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
config="$here/config/codebase.json"
field() { node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]])" "$config" "$1"; }
commit="$(field commit)"
repository="$(field repository)"
# The codebase version name and its folder come from lib.mjs, the one place that holds them.
lib() { node --input-type=module -e "import * as lib from '$here/scripts/lib.mjs'; console.log(process.argv[1] === 'name' ? lib.publishedCodebaseVersion : lib.codebaseVersionDir(lib.publishedCodebaseVersion))" "$1"; }
codebase_version="$(lib name)"
published="$(lib directory)"

if [ ! -d "$published/.git" ]; then
	git clone -q "$repository" "$published"
fi

origin="$(git -C "$published" remote get-url origin)"
[ "$origin" = "$repository" ] || { echo "$published has origin $origin, expected $repository; remove it or fix the configuration" >&2; exit 1; }

git -C "$published" checkout -q "$commit"
[ "$(git -C "$published" rev-parse HEAD)" = "$commit" ] || { echo "$published is not at the pinned commit $commit" >&2; exit 1; }
git -C "$published" diff --quiet || { echo "$published has local changes; reset it first" >&2; exit 1; }

# Dependencies live in work/deps so every codebase version and agent task run copy shares them through a symlink.
deps="$here/work/deps/node_modules"
if [ ! -d "$deps" ]; then
	node "$here/scripts/install-codebase.mjs" "$published" >/dev/null
	mkdir -p "$here/work/deps"
	mv "$published/node_modules" "$deps"
fi
[ -L "$published/node_modules" ] || ln -s ../deps/node_modules "$published/node_modules"

node "$here/scripts/compile-codebase.mjs" "$codebase_version"
node "$here/scripts/execute-verification-suite.mjs" "$codebase_version"
