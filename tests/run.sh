#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "not ok - $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] || fail "$label: expected [$expected], got [$actual]"
}

mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
payload="$(cat)"
printf '%s' "$payload" > "${FAKE_CURL_PAYLOAD:?}"
cat <<'JSON'
{"choices":[{"message":{"content":"<think>hidden reasoning</think>\nPLAN OK"}}]}
JSON
FAKE_CURL
chmod +x "$TMP_DIR/bin/curl"

export PATH="$TMP_DIR/bin:$PATH"
export FAKE_CURL_PAYLOAD="$TMP_DIR/payload.json"

cd "$ROOT"

plan_output="$(./scripts/minimax-plan "make a tiny plan")"
assert_eq "PLAN OK" "$plan_output" "minimax-plan strips think blocks"

review_output="$(./scripts/minimax-review --diff-file /dev/null)"
assert_eq "PLAN OK" "$review_output" "minimax-review calls MiniMax and strips think blocks"

rm -rf plans
hybrid_output="$(./scripts/codex-hybrid-task "add a feature")"
[[ "$hybrid_output" == *"plans/latest-minimax-plan.md"* ]] || fail "hybrid task should print saved plan path"
[[ -f plans/latest-minimax-plan.md ]] || fail "hybrid task should write latest plan"
grep -q "PLAN OK" plans/latest-minimax-plan.md || fail "hybrid plan should contain MiniMax output"
grep -q "add a feature" plans/latest-minimax-plan.md || fail "hybrid plan should record original task"

echo "ok - hybrid MiniMax scripts"
