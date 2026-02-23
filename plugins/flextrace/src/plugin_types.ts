export interface TraceToolRuntime {
  sessionId?: string;
  rootSessionId?: string;
  agentId?: string;
  ts?: number;
}

export interface TraceToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, runtime: TraceToolRuntime) => Promise<Record<string, unknown>>;
}
