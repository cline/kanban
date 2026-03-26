#!/usr/bin/env bash
set -euo pipefail

fail() {
	echo "$*" >&2
	exit 1
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this script from inside a git worktree."
repo_root="$(cd "$repo_root" && pwd -P)"

main_worktree=""
while IFS= read -r line; do
	case "$line" in
		worktree\ *)
			candidate="${line#worktree }"
			if [ -d "$candidate/.git" ]; then
				main_worktree="$(cd "$candidate" && pwd -P)"
				break
			fi
			;;
	esac
done < <(git -C "$repo_root" worktree list --porcelain)

[ -n "$main_worktree" ] || fail "Could not find the primary worktree for this repository."

if [ "$repo_root" = "$main_worktree" ]; then
	echo "Current checkout is the primary worktree at $repo_root."
	echo "Run npm run install:all here. Secondary worktrees should run bash ./scripts/setup-worktree-env.sh."
	exit 0
fi

linked_count=0
missing_sources=()

while IFS= read -r -d '' package_json; do
	package_dir="$(dirname "$package_json")"
	source_node_modules="$package_dir/node_modules"
	relative_dir="${package_dir#$main_worktree}"
	relative_dir="${relative_dir#/}"

	if [ ! -e "$source_node_modules" ]; then
		missing_sources+=("${relative_dir:-.}/node_modules")
		continue
	fi

	target_dir="$repo_root"
	if [ -n "$relative_dir" ]; then
		target_dir="$repo_root/$relative_dir"
	fi
	target_node_modules="$target_dir/node_modules"

	if [ -L "$target_node_modules" ] && [ "$(readlink "$target_node_modules")" = "$source_node_modules" ]; then
		echo "Already linked: ${relative_dir:-.}/node_modules"
		continue
	fi

	rm -rf "$target_node_modules"
	ln -s "$source_node_modules" "$target_node_modules"
	echo "Linked ${relative_dir:-.}/node_modules -> $source_node_modules"
	linked_count=$((linked_count + 1))
done < <(
	find "$main_worktree" \
		-type d \( -name .git -o -name node_modules -o -name dist -o -name coverage \) -prune -o \
		-name package.json -print0
)

if [ "${#missing_sources[@]}" -gt 0 ]; then
	echo "Missing installs in the primary worktree ($main_worktree):" >&2
	for missing_source in "${missing_sources[@]}"; do
		echo "  - $missing_source" >&2
	done
	fail "Run npm run install:all in the primary worktree, then rerun bash ./scripts/setup-worktree-env.sh."
fi

if [ "$linked_count" -eq 0 ]; then
	echo "Nothing to relink; shared installs are already configured."
fi
