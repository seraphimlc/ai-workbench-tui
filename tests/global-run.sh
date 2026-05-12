#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/tools/codex-minimax"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "not ok - $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  [[ "$haystack" == *"$needle"* ]] || fail "$label: missing [$needle]"
}

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/config" "$TMP_DIR/project"
cat > "$TMP_DIR/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
payload=""
if [[ "${1:-}" == "--config" && -n "${2:-}" ]]; then
  data_ref="$(awk -F'@' '/^data = / {gsub(/"$/, "", $2); print $2}' "$2")"
  payload="$(cat "$data_ref")"
else
  payload="$(cat)"
fi
printf '%s' "$payload" > "${FAKE_CURL_PAYLOAD:?}"
if [[ -n "${FAKE_CURL_RESPONSE:-}" ]]; then
  printf '%s' "$FAKE_CURL_RESPONSE"
  exit 0
fi
cat <<'JSON'
{"choices":[{"message":{"content":"<think>hidden reasoning</think>\nGLOBAL OK"}}]}
JSON
FAKE_CURL
chmod +x "$TMP_DIR/bin/curl"

cat > "$TMP_DIR/config/env" <<'ENV'
MINIMAX_API_KEY=sk-test
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M2.7
ENV
chmod 600 "$TMP_DIR/config/env"

export PATH="$TMP_DIR/bin:$PATH"
export CODEX_MINIMAX_CONFIG_DIR="$TMP_DIR/config"
export FAKE_CURL_PAYLOAD="$TMP_DIR/payload.json"

status_output="$("$SCRIPT" status)"
assert_contains "$status_output" "MINIMAX_API_KEY=configured" "status should hide and detect key"
assert_contains "$status_output" "MINIMAX_MODEL=MiniMax-M2.7" "status should show model"
assert_contains "$status_output" "MINIMAX_REASONING_SPLIT=true" "status should show reasoning split"

ask_output="$("$SCRIPT" ask "hello")"
[[ "$ask_output" == "GLOBAL OK" ]] || fail "ask should strip think blocks"
jq -e '.reasoning_split == true' "$FAKE_CURL_PAYLOAD" >/dev/null || fail "requests should enable reasoning_split by default"

"$SCRIPT" ask --max-tokens 777 "hello" >/dev/null
jq -e '.max_tokens == 777' "$FAKE_CURL_PAYLOAD" >/dev/null || fail "ask should pass custom max_tokens"

ask_saved="$("$SCRIPT" ask --output "$TMP_DIR/answer.md" "hello")"
assert_contains "$ask_saved" "MiniMax answer saved:" "ask --output should print saved path"
grep -q "GLOBAL OK" "$TMP_DIR/answer.md" || fail "ask --output should save full answer"

export FAKE_CURL_RESPONSE='{"choices":[{"finish_reason":"length","message":{"content":"partial answer"}}]}'
truncated_output="$("$SCRIPT" ask --max-tokens 777 "hello" 2>&1)"
assert_contains "$truncated_output" "partial answer" "truncated response should still print content"
assert_contains "$truncated_output" "may be truncated" "truncated response should warn"

export FAKE_CURL_RESPONSE='{"choices":[{"finish_reason":"length","message":{"content":"<think>unfinished hidden reasoning"}}]}'
unfinished_think_output="$("$SCRIPT" ask --max-tokens 777 "hello" 2>&1)"
assert_contains "$unfinished_think_output" "may be truncated" "unfinished think response should warn"
[[ "$unfinished_think_output" != *"unfinished hidden reasoning"* ]] || fail "unfinished think block should be stripped"

export FAKE_CURL_RESPONSE='{"choices":[{"finish_reason":"length","message":{"content":"","reasoning_content":"hidden reasoning"}}]}'
no_final_output="$("$SCRIPT" ask --max-tokens 777 "hello" 2>&1)"
assert_contains "$no_final_output" "no final answer" "reasoning-only response should warn"
unset FAKE_CURL_RESPONSE

cd "$TMP_DIR/project"
plan_output="$("$SCRIPT" plan "add feature")"
assert_contains "$plan_output" "plans/latest-minimax-plan.md" "plan should report output path"
[[ -f plans/latest-minimax-plan.md ]] || fail "plan should create project-local plan"
grep -q "GLOBAL OK" plans/latest-minimax-plan.md || fail "plan should contain MiniMax output"
grep -q "add feature" plans/latest-minimax-plan.md || fail "plan should record task"

"$SCRIPT" init >/tmp/codex-minimax-init.out
[[ -f AGENTS.md ]] || fail "init should create AGENTS.md"
grep -q "Codex MiniMax Hybrid Workflow" AGENTS.md || fail "init should add marker"

review_output="$("$SCRIPT" review --diff-file /dev/null)"
assert_contains "$review_output" "MiniMax review saved:" "review should save by default"
grep -q "GLOBAL OK" reviews/latest-minimax-review.md || fail "review should save full output"

review_stdout="$("$SCRIPT" review --stdout --diff-file /dev/null)"
[[ "$review_stdout" == "GLOBAL OK" ]] || fail "review --stdout should print output"

echo "ok - global codex-minimax"
