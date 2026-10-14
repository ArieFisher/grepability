#!/usr/bin/env bash
# The published codebase: the codebase at its pinned commit, dependencies installed, compiled, baseline test results recorded.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
config="$here/config/codebase.json"
# A field of the codebase configuration; a command (a list of words) prints as one line.
field() { node -e "const v=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]];console.log(Array.isArray(v)?v.join(' '):v)" "$config" "$1"; }
commit="$(field commit)"
repository="$(field repository)"
read -ra install <<<"$(field install)"
# The version name and its folder come from lib.mjs, the one place that holds them.
lib() { node --input-type=module -e "import * as lib from '$here/scripts/lib.mjs'; console.log(process.argv[1] === 'name' ? lib.publishedVersion : lib.versionDir(lib.publishedVersion))" "$1"; }
version="$(lib name)"
published="$(lib directory)"

if [ ! -d "$published/.git" ]; then
	git clone -q "$repository" "$published"
fi

origin="$(git -C "$published" remote get-url origin)"
[ "$origin" = "$repository" ] || { echo "$published has origin $origin, expected $repository; remove it or fix the configuration" >&2; exit 1; }

git -C "$published" checkout -q "$commit"
[ "$(git -C "$published" rev-parse HEAD)" = "$commit" ] || { echo "$published is not at the pinned commit $commit" >&2; exit 1; }
git -C "$published" diff --quiet || { echo "$published has local changes; reset it first" >&2; exit 1; }

# Dependencies live in work/deps so every version and run copy shares them through a symlink.
deps="$here/work/deps/node_modules"
if [ ! -d "$deps" ]; then
	(cd "$published" && "${install[@]}" >/dev/null)
	mkdir -p "$here/work/deps"
	mv "$published/node_modules" "$deps"
fi
[ -L "$published/node_modules" ] || ln -s ../deps/node_modules "$published/node_modules"

node "$here/scripts/compile-codebase.mjs" "$version"
node "$here/scripts/run-tests.mjs" "$version"
