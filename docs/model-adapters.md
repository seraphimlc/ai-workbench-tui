# Model Adapters

AI Workbench keeps model calls outside the core TUI. This lets each user bring
their own reasoning model and execution model without changing the workbench.

## Reasoning Models

Use any model or tool that can write planning output to files.

```bash
your-reasoning-model > /tmp/spec-output.md
your-todo-generator > /tmp/todo-output.yaml

ai-workbench plan \
  --prompt "Plan the next iteration" \
  --spec-output /tmp/spec-output.md \
  --todo-output /tmp/todo-output.yaml
```

The todo output must contain a `tasks` array compatible with
`.ai/workflow-todo.yaml`.

## Execution Models

Execution models are external commands configured in
`.ai/executor-profiles.yaml`.

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

Run the next queued task:

```bash
ai-workbench run-next --profile my-agent
```

The executor receives the handoff prompt on stdin. It should write useful
progress to stdout/stderr and exit with code `0` when the assigned work
completed. Non-zero exit codes and timeouts mark the task `blocked`.

## Starter Executor

The repository includes a minimal executor:

```bash
echo "# Executor handoff" | node examples/executors/echo-executor.js
```

Use it to verify profiles and shell wiring before connecting a real coding
agent.

## Checks

```bash
ai-workbench init --name "My Project"
ai-workbench doctor
ai-workbench run-next --validate-profiles
ai-workbench run-next --dry-run --profile my-agent
```
