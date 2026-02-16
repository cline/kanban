#!/bin/bash
set -e

if [ -d "node_modules" ]; then
  exit 0
fi

MAIN_WORKTREE="$(git worktree list | awk 'NR==1 {print $1}')"

if [ -z "${MAIN_WORKTREE}" ]; then
  echo "Could not determine main worktree path."
  exit 1
fi

if [ ! -e "node_modules" ]; then
  ln -s "$MAIN_WORKTREE/node_modules" node_modules
fi

if [ -d "web-ui" ] && [ ! -e "web-ui/node_modules" ]; then
  ln -s "$MAIN_WORKTREE/web-ui/node_modules" web-ui/node_modules
fi
