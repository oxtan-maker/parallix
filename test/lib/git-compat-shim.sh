#!/bin/sh
# Git compatibility shim for the unit-test PATH (see bootstrap-parallix-home.ts).
# macOS still ships Git 2.24 on some supported workstations, whose `git init`
# lacks `-b`. This shim rewrites that one spelling and forwards everything
# else to the real executable named by PARALLIX_TEST_REAL_GIT.
#
# Pure POSIX sh on purpose: every unit-test git call routes through here, so
# the rewrite must not cost a Node round-trip (~50-100 ms each). Under the
# 12-worker unit suite those round-trips pushed whole tests past the 1 s
# per-test budget and flaked the gate (task-2431 pre-review repair).

real_git="$PARALLIX_TEST_REAL_GIT"
if [ -z "$real_git" ]; then
  # Recursion guard: the first `git` on PATH may be this shim. Pick the first
  # executable that is not the file we are running from.
  real_git=""
  old_ifs=$IFS
  IFS=:
  for dir in $PATH; do
    if [ -x "$dir/git" ] && [ "$dir/git" != "$0" ]; then
      real_git="$dir/git"
      break
    fi
  done
  IFS=$old_ifs
  [ -n "$real_git" ] || real_git=git
fi

saw_init=0
want_branch=0
need_rewrite=0
branch=""
want_c=0
c_value=""
init_args=""
init_tokens=0
last=""
prev=""
for a in "$@"; do
  if [ "$want_c" = "1" ]; then
    [ -n "$c_value" ] || c_value="$a"
    want_c=0
  fi
  if [ "$a" = "-C" ]; then
    want_c=1
  elif [ "$prev" = "init" ] && [ "$a" = "-b" ]; then
    want_branch=1
    continue
  elif [ "$want_branch" = "1" ]; then
    branch="$a"
    need_rewrite=1
    want_branch=0
    prev="$a"
    continue
  fi
  [ "$saw_init" = "0" ] && [ "$a" = "init" ] && saw_init=1
  init_args="$init_args $a"
  init_tokens=$((init_tokens + 1))
  last="$a"
  prev="$a"
done

if [ "$need_rewrite" = "1" ]; then
  # shellcheck disable=SC2086
  "$real_git" $init_args
  status=$?
  [ "$status" -eq 0 ] || exit "$status"
  target="$c_value"
  [ -n "$target" ] || [ "$init_tokens" -le 1 ] || target="$last"
  [ -n "$target" ] || target="."
  "$real_git" -C "$target" checkout -b "$branch"
  exit $?
fi

exec "$real_git" "$@"
