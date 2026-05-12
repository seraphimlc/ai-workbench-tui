# MiniMax + Codex Hybrid Workflow

## AI Workbench TUI MVP

This workspace now contains a TypeScript MVP for a controller-led AI workbench:

- main thread: discussion, planning, spec, todo, iteration
- executor agents: bounded implementation and test runs
- reviewer agents: independent review evidence
- deterministic state: `.ai/spec.md`, `.ai/workflow-todo.yaml`, `.ai/runs/**`,
  `.ai/iterations/**`

Run the current TUI shell:

```bash
npm install
npm test
npm run build
node dist/src/tui/cli.js --render-once
```

Useful commands:

```bash
node dist/src/tui/cli.js status
node dist/src/tui/cli.js iterations
node dist/src/tui/cli.js iteration-draft --title "Next Round"
node dist/src/tui/cli.js plan --prompt "Update plan" --spec-output /tmp/spec.md --todo-output /tmp/todo.yaml
```

The MVP intentionally keeps model calls outside the TUI core. Commands consume
model output files, save full artifacts, and print compact summaries.

## MiniMax + Codex Hybrid Workflow

这个工作区把便宜推理和可靠执行拆开：

- MiniMax：负责规划、拆任务、列风险、做便宜的 diff review。
- Codex/GPT：负责读代码、改文件、跑测试、处理失败、最终判断。

## 配置

密钥保存在 `.env.minimax`，文件权限应为 `600`。这个文件被 `.gitignore` 忽略，不要提交。

默认接口：

```bash
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M2.7
```

## 命令

推荐只记这个全局入口：

```bash
codex-minimax plan "修复登录页按钮点击无效的问题"
```

查看当前 MiniMax 配置，但不打印密钥：

```bash
codex-minimax status
```

长输出任务可以提高输出上限：

```bash
codex-minimax plan --max-tokens 8000 "复杂代码任务"
codex-minimax ask --max-tokens 8000 "给我完整分析"
codex-minimax review --max-tokens 10000
```

为了节省 Codex 对话上下文 token，长回答建议落盘，不直接打印：

```bash
codex-minimax ask --output minimax-answer.md --max-tokens 8000 "给我完整分析"
```

`review` 默认就是落盘模式：

```bash
codex-minimax review
```

它会保存到：

```text
reviews/latest-minimax-review.md
```

如果确实要直接打印 review：

```bash
codex-minimax review --stdout
```

默认输出上限来自：

```bash
MINIMAX_MAX_TOKENS=4000
```

如果 MiniMax 返回 `finish_reason=length`，命令会提示 `output may be truncated`，这时用更高的 `--max-tokens` 重跑。

在任意项目里安装 Codex 项目说明：

```bash
codex-minimax init
```

让 MiniMax 直接规划：

```bash
codex-minimax ask "帮我拆解这个代码任务"
```

创建一次 Codex 可执行的混合任务计划：

```bash
codex-minimax plan "修复登录页按钮点击无效的问题"
```

它会把计划写到：

```text
plans/latest-minimax-plan.md
```

让 MiniMax 做便宜代码审查：

```bash
codex-minimax review
```

审查指定 diff 文件：

```bash
codex-minimax review --diff-file /tmp/change.diff "重点看边界条件"
```

## 推荐流程

1. 在项目里运行 `codex-minimax init`，生成或追加 `AGENTS.md`。
2. 先运行 `codex-minimax plan "任务"`。
2. Codex/GPT 读取 `plans/latest-minimax-plan.md`。
3. Codex/GPT 按计划检查代码、实现、跑测试。
4. 如果有 git diff，运行 `codex-minimax review` 做低成本复查。
5. Codex/GPT 对 MiniMax 的审查意见做最终判断，只采纳真实问题。

MiniMax 的计划是输入，不是命令。真正修改代码和验收仍由 Codex/GPT 负责。

## 在 Codex 里怎么指定使用

你可以直接对 Codex 说：

```text
用 MiniMax 混合模式处理：<你的任务>
```

对应的固定动作是：

```bash
codex-minimax plan "<你的任务>"
```

然后 Codex/GPT 读取 `plans/latest-minimax-plan.md` 并执行代码部分。
