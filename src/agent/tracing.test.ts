import assert from "node:assert/strict";
import test from "node:test";
import { getAgentTracingConfig } from "./tracing";

test("keeps agent tracing disabled without LangSmith credentials", () => {
  assert.deepEqual(getAgentTracingConfig({ LANGSMITH_TRACING: "false" }), { enabled: false });
});

test("requires LangSmith credentials and a project when tracing is enabled", () => {
  assert.throws(
    () => getAgentTracingConfig({ LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: "key" }),
    /LANGSMITH_PROJECT/,
  );
});

test("reads an enabled agent tracing configuration", () => {
  assert.deepEqual(getAgentTracingConfig({
    LANGSMITH_TRACING: "true",
    LANGSMITH_API_KEY: "key",
    LANGSMITH_PROJECT: "hijau-ai",
    LANGSMITH_ENDPOINT: "https://apac.api.smith.langchain.com",
  }), {
    enabled: true,
    apiKey: "key",
    project: "hijau-ai",
    endpoint: "https://apac.api.smith.langchain.com",
  });
});
