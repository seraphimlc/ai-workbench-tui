# Getting Started

This project is a local AI workbench for controller-led planning and
executor-led implementation. It does not require a specific model provider.

## Requirements

- Node.js 18 or newer
- npm
- An executor command if you want to run real implementation tasks

## Install From This Repository

```bash
npm install
npm run build
```

Run commands through the built CLI:

```bash
node dist/src/tui/cli.js --help
```

For local command-style use:

```bash
npm link
ai-workbench --help
```

## Create A Workbench Project

Inside the project you want to manage:

```bash
ai-workbench init --name "My Project"
ai-workbench doctor
```

`init` creates:

- `.ai/spec.md`
- `.ai/workflow-todo.yaml`
- `.ai/alignment.md`
- `.ai/executor-profiles.yaml`

`doctor` checks required files, Node.js, todo parsing, and executor profiles.

## Try The Example Executor

From this repository:

```bash
echo "# Executor handoff" | node examples/executors/echo-executor.js
```

In a real workbench project, configure `.ai/executor-profiles.yaml` to call your
own executor command.

## Connect Your Reasoning Model

The workbench consumes reasoning output from files:

```bash
ai-workbench plan \
  --prompt "Plan the next safe iteration" \
  --spec-output /tmp/spec-output.md \
  --todo-output /tmp/todo-output.yaml
```

Any model can be used if it writes those files in the expected format.

## Connect Your Execution Model

Configure an executor profile:

```yaml
version: 1
default_profile: my-agent
profiles:
  my-agent:
    command: my-agent-cli
    args:
      - run
      - --model
      - my-model
    success_status: review
    timeout_ms: 300000
```

Preview before running:

```bash
ai-workbench run-next --dry-run --profile my-agent
```

Run:

```bash
ai-workbench run-next --profile my-agent
```

## Keep The Agent Aligned

Use the alignment checkpoint before starting a new loop:

```bash
ai-workbench align
```

If it says `Decision: stop`, prefer review, consolidation, or a new objective
lock before adding more features.
