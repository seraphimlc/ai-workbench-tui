import { readFile } from "node:fs/promises";
import YAML from "yaml";

import type { Route, RoutesConfig } from "../shared/types.js";

export type RouteOverrideConfig = {
  version?: number;
  defaults?: Record<string, Partial<Route>>;
  upgrade_rules?: UpgradeRule[];
};

export type RouteResolutionContext = {
  risk?: string | string[];
  tests_failed_count?: number;
  changed_files_count?: number;
};

export type RouteResolutionInput = {
  taskType: string;
  globalConfig: RoutesConfig;
  projectConfig?: RouteOverrideConfig;
  runOverride?: Partial<Route>;
  context?: RouteResolutionContext;
};

export type ResolvedRoute = {
  taskType: string;
  route: Route;
  appliedUpgradeRules: string[];
};

type UpgradeRule = {
  id?: string;
  when?: {
    risk?: string[];
    tests_failed_count_gte?: number;
    changed_files_gte?: number;
  };
  route?: Partial<Route>;
};

export function parseRoutesConfig(source: string): RoutesConfig {
  const parsed = YAML.parse(source) as RoutesConfig;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Route config must be a YAML object.");
  }
  if (!parsed.defaults || typeof parsed.defaults !== "object") {
    throw new Error("Route config must define defaults.");
  }

  return parsed;
}

export async function loadRoutesConfig(path: string): Promise<RoutesConfig> {
  return parseRoutesConfig(await readFile(path, "utf8"));
}

export function resolveRoute(input: RouteResolutionInput): ResolvedRoute {
  const baseRoute = input.globalConfig.defaults[input.taskType];
  if (!baseRoute) {
    throw new Error(`No route configured for task type: ${input.taskType}`);
  }

  const projectRoute = input.projectConfig?.defaults?.[input.taskType] ?? {};
  let route: Route = {
    ...baseRoute,
    ...projectRoute,
    ...(input.runOverride ?? {}),
  };

  const appliedUpgradeRules: string[] = [];
  for (const rule of getUpgradeRules(input.globalConfig, input.projectConfig)) {
    if (!matchesUpgradeRule(rule, input.context)) {
      continue;
    }

    route = {
      ...route,
      ...(rule.route ?? {}),
    };
    appliedUpgradeRules.push(rule.id ?? "unnamed-upgrade-rule");
  }

  return {
    taskType: input.taskType,
    route,
    appliedUpgradeRules,
  };
}

function getUpgradeRules(
  globalConfig: RoutesConfig,
  projectConfig?: RouteOverrideConfig,
): UpgradeRule[] {
  return [
    ...((globalConfig.upgrade_rules as UpgradeRule[] | undefined) ?? []),
    ...(projectConfig?.upgrade_rules ?? []),
  ];
}

function matchesUpgradeRule(
  rule: UpgradeRule,
  context: RouteResolutionContext = {},
): boolean {
  if (!rule.when) {
    return false;
  }

  const checks: boolean[] = [];

  if (rule.when.risk) {
    checks.push(intersects(toArray(context.risk), rule.when.risk));
  }

  if (typeof rule.when.tests_failed_count_gte === "number") {
    checks.push(
      (context.tests_failed_count ?? 0) >= rule.when.tests_failed_count_gte,
    );
  }

  if (typeof rule.when.changed_files_gte === "number") {
    checks.push((context.changed_files_count ?? 0) >= rule.when.changed_files_gte);
  }

  return checks.length > 0 && checks.every(Boolean);
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function intersects(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}
