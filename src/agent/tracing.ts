import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";

export type AgentTracingConfig =
  | { enabled: false }
  | { enabled: true; apiKey: string; project: string; endpoint?: string };

type AgentEnvironment = Record<string, string | undefined>;

function required(environment: AgentEnvironment, key: "LANGSMITH_API_KEY" | "LANGSMITH_PROJECT"): string {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`${key} must be configured when LANGSMITH_TRACING is enabled`);
  }
  return value;
}

export function getAgentTracingConfig(environment: AgentEnvironment = process.env): AgentTracingConfig {
  if (environment.LANGSMITH_TRACING?.trim().toLowerCase() !== "true") {
    return { enabled: false };
  }

  const endpoint = environment.LANGSMITH_ENDPOINT?.trim();
  return {
    enabled: true,
    apiKey: required(environment, "LANGSMITH_API_KEY"),
    project: required(environment, "LANGSMITH_PROJECT"),
    ...(endpoint ? { endpoint } : {}),
  };
}

export function traceAgentOperation<Operation extends (...args: never[]) => unknown>(name: string, operation: Operation, metadata?: Record<string, unknown>, runId?: string): Operation {
  const config = getAgentTracingConfig();
  if (!config.enabled) {
    return operation;
  }

  const client = new Client({ apiKey: config.apiKey, apiUrl: config.endpoint });
  return traceable(operation, {
    name,
    run_type: "chain",
    project_name: config.project,
    client,
    tracingEnabled: true,
    metadata,
    ...(runId ? { id: runId } : {}),
  }) as Operation;
}
