import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseRoutesConfig,
  resolveRoute,
  type RouteOverrideConfig,
} from "../../src/router/index.js";

const routesYaml = `
version: 0.1
defaults:
  coding:
    agent: executor
    model: gpt-5.5
    mode: background
    fallback: gpt-5.4
  discussion:
    agent: orchestrator
    model: minimax
    mode: interactive
    fallback: gpt-5.5
upgrade_rules:
  - id: high-risk-work
    when:
      risk:
        - security
        - payment
        - migration
        - data-loss
    route:
      model: gpt-5.5
      require_human_approval: true
`;

describe("model router", () => {
  it("resolves a default route for a task type", () => {
    const globalConfig = parseRoutesConfig(routesYaml);

    const resolved = resolveRoute({
      taskType: "coding",
      globalConfig,
    });

    assert.deepEqual(resolved.route, {
      agent: "executor",
      model: "gpt-5.5",
      mode: "background",
      fallback: "gpt-5.4",
    });
    assert.deepEqual(resolved.appliedUpgradeRules, []);
  });

  it("applies project config over global defaults", () => {
    const globalConfig = parseRoutesConfig(routesYaml);
    const projectConfig: RouteOverrideConfig = {
      defaults: {
        coding: {
          model: "project-coding-model",
          fallback: "project-fallback",
        },
      },
    };

    const resolved = resolveRoute({
      taskType: "coding",
      globalConfig,
      projectConfig,
    });

    assert.equal(resolved.route.agent, "executor");
    assert.equal(resolved.route.model, "project-coding-model");
    assert.equal(resolved.route.mode, "background");
    assert.equal(resolved.route.fallback, "project-fallback");
  });

  it("applies a single-run override over project and global defaults", () => {
    const globalConfig = parseRoutesConfig(routesYaml);
    const projectConfig: RouteOverrideConfig = {
      defaults: {
        coding: {
          model: "project-coding-model",
          mode: "interactive",
        },
      },
    };

    const resolved = resolveRoute({
      taskType: "coding",
      globalConfig,
      projectConfig,
      runOverride: {
        model: "run-model",
        mode: "background",
        require_review: true,
      },
    });

    assert.equal(resolved.route.agent, "executor");
    assert.equal(resolved.route.model, "run-model");
    assert.equal(resolved.route.mode, "background");
    assert.equal(resolved.route.fallback, "gpt-5.4");
    assert.equal(resolved.route.require_review, true);
  });

  it("applies high-risk escalation rules", () => {
    const globalConfig = parseRoutesConfig(routesYaml);

    const resolved = resolveRoute({
      taskType: "discussion",
      globalConfig,
      context: {
        risk: "payment",
      },
    });

    assert.equal(resolved.route.agent, "orchestrator");
    assert.equal(resolved.route.model, "gpt-5.5");
    assert.equal(resolved.route.mode, "interactive");
    assert.equal(resolved.route.fallback, "gpt-5.5");
    assert.equal(resolved.route.require_human_approval, true);
    assert.deepEqual(resolved.appliedUpgradeRules, ["high-risk-work"]);
  });

  it("requires every condition in an escalation rule to match", () => {
    const globalConfig = parseRoutesConfig(routesYaml);
    const projectConfig: RouteOverrideConfig = {
      upgrade_rules: [
        {
          id: "security-after-repeated-failures",
          when: {
            risk: ["security"],
            tests_failed_count_gte: 2,
          },
          route: {
            require_review: true,
          },
        },
      ],
    };

    const resolved = resolveRoute({
      taskType: "coding",
      globalConfig,
      projectConfig,
      context: {
        risk: "payment",
        tests_failed_count: 2,
      },
    });

    assert.equal(resolved.route.require_review, undefined);
    assert.deepEqual(resolved.appliedUpgradeRules, ["high-risk-work"]);
  });
});
