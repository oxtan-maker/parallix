#!/usr/bin/env bash
# TASK-2591 — minimal probe of how c8 and Node native coverage attribute
# execution to TypeScript sources. Usage (from the repository root):
#   NODE26=<node >= 26.7> C8=<c8 10.x> bash tools/coverage-comparison/bundle-attribution-probe/run.sh
# Prints each tool's LCOV DA records for:
#   mod.test.ts    — in-process tsx execution plus a tsx grandchild
#   bundle.test.ts — a grandchild running a minified, source-mapped esbuild
#                    bundle (the shape of build/px.mjs in integration tests)
set -euo pipefail
: "${NODE26:?set NODE26 to a Node >= 26.7 executable}"
: "${C8:?set C8 to a c8 10.x executable}"
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
work="$(mktemp -d "$repo/tmp/coverage-probe-XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp -r "$(dirname "$0")/src" "$(dirname "$0")/test" "$work/"
ln -s "$repo/node_modules" "$work/node_modules"
cd "$work"
npx esbuild src/entry.ts --bundle --platform=node --format=esm --minify --sourcemap --outfile=build/px.mjs --log-level=error
summarize() { grep -E '^SF|^DA' "$1" | tr '\n' ' ' | sed 's/SF:/\n  SF:/g'; echo; }
for suite in mod bundle; do
  "$C8" --all --extension .ts --exclude-after-remap --include 'src/**/*.ts' --reporter=lcov --reports-dir="c8-$suite" \
    "$NODE26" --import tsx --test "test/$suite.test.ts" >/dev/null 2>&1
  echo "c8 ($suite.test.ts):"; summarize "c8-$suite/lcov.info"
  "$NODE26" --enable-source-maps --import tsx --experimental-test-coverage --test-coverage-include-all \
    --test-coverage-include='src/**/*.ts' --test-reporter=lcov --test-reporter-destination="native-$suite.info" \
    --test "test/$suite.test.ts" >/dev/null 2>&1
  echo "native ($suite.test.ts):"; summarize "native-$suite.info"
done
