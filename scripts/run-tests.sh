#!/bin/bash
# Run the CLI unit tests with each test file in its own `bun test` process.
#
# Why per-process: bun's module mocks (`vi.mock` / `mock.module`) are NOT
# isolated per test file the way Vitest's are — a `vi.mock('fs-extra', ...)` in
# one file leaks into every other file that runs later in the same process. The
# suite has many files that mock `fs-extra`/`auth` plus others that use the real
# modules, so they must not share a process. One file per process is the
# deterministic fix (the frontend uses the same separate-process strategy in
# scripts/test-sharded.sh).
#
# Files run up to `cores` at a time. Each file gets a perl alarm so a hung file
# fails that file instead of stalling the whole run. Any positional args are
# treated as explicit test files to run instead of the full discovery (so
# `./scripts/run-tests.sh src/test/typescript/lib/config.test.ts` works for
# focused runs); extra `bun test` flags can be passed via BUN_TEST_FLAGS.

set -u

PER_FILE_TIMEOUT=${CLI_TEST_TIMEOUT:-120}
BUN_TEST_FLAGS=${BUN_TEST_FLAGS:-}

if [ "$#" -gt 0 ]; then
    FILES=("$@")
else
    # LC_ALL=C for a stable, platform-independent ordering.
    FILES=($(find src/test -name "*.test.ts" | LC_ALL=C sort))
fi

echo "Running ${#FILES[@]} test file(s), one process each"

cores=$( (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 8) )
max_parallel=${CLI_TEST_PARALLEL:-$cores}

mkdir -p build/test-files
rm -f build/test-files/*.log

pids=()
logs=()
names=()
for f in "${FILES[@]}"; do
    while [ "$(jobs -rp | wc -l)" -ge "$max_parallel" ]; do sleep 0.2; done
    log="build/test-files/$(echo "$f" | tr '/' '_').log"
    perl -e "alarm $PER_FILE_TIMEOUT; exec @ARGV" \
        bun test --timeout 30000 $BUN_TEST_FLAGS "$f" > "$log" 2>&1 &
    pids+=($!)
    logs+=("$log")
    names+=("$f")
done

exit_code=0
for idx in "${!pids[@]}"; do
    if ! wait "${pids[$idx]}"; then
        exit_code=1
    fi
done

echo ""
echo "=== Test Results ==="
total_pass=0; total_fail=0; total_skip=0
for idx in "${!logs[@]}"; do
    log="${logs[$idx]}"
    [ -f "$log" ] || continue
    pass=$(grep -oE "[0-9]+ pass" "$log" 2>/dev/null | tail -1 | grep -oE "^[0-9]+" || true)
    fail=$(grep -oE "[0-9]+ fail" "$log" 2>/dev/null | tail -1 | grep -oE "^[0-9]+" || true)
    skip=$(grep -oE "[0-9]+ skip" "$log" 2>/dev/null | tail -1 | grep -oE "^[0-9]+" || true)
    total_pass=$((total_pass + ${pass:-0}))
    total_fail=$((total_fail + ${fail:-0}))
    total_skip=$((total_skip + ${skip:-0}))
    if [ "${fail:-0}" -gt 0 ]; then
        echo "FAIL ${names[$idx]}: ${pass:-0} pass, ${fail:-0} fail"
    fi
done
echo "---"
echo "Total: $total_pass pass, $total_fail fail, $total_skip skip"

if [ $exit_code -ne 0 ]; then
    echo ""
    echo "=== Failure details ==="
    for log in "${logs[@]}"; do
        [ -f "$log" ] || continue
        grep -E "\(fail\)|error:|hung" "$log" 2>/dev/null || true
    done
    exit 1
fi
echo "All test files passed!"
