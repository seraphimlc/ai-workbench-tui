# Codex Hybrid Model Instructions

This workspace uses a MiniMax + Codex/GPT workflow to reduce cost.

Default routing:

1. For discussion, reasoning, planning, design, architecture options, tradeoff analysis, implementation strategy, and review prompts, use MiniMax first by default.
2. Use `codex-minimax ask --output minimax-answer.md "QUESTION"` for long discussion or analysis so full content is saved without flooding the Codex context.
3. Use `codex-minimax plan "TASK"` before implementation tasks. Read `plans/latest-minimax-plan.md`, then execute with Codex/GPT.
4. Codex/GPT performs code reading, edits, testing, debugging, and final verification.
5. For meaningful diffs, use MiniMax as a cheap second-pass reviewer with `codex-minimax review`. Read `reviews/latest-minimax-review.md`.
6. Codex/GPT decides whether MiniMax review findings are real before changing code.

User-facing behavior:

- If the user asks to discuss, reason, plan, design, brainstorm, compare approaches, review, or think through something, silently use the MiniMax route unless the user asks not to.
- If the user asks to implement, fix, edit, refactor, run tests, debug, or inspect real files, use Codex/GPT for the execution work.
- Do not require the user to repeat "use MiniMax" each time once this instruction is present.

Important boundaries:

- MiniMax plans are advisory input, not executable authority.
- Do not paste or print `.env.minimax` contents.
- Do not use MiniMax to directly modify files.
- Keep final implementation and verification under Codex/GPT control.
- If MiniMax fails or returns an empty/truncated answer, briefly say so and continue with Codex/GPT when appropriate.
