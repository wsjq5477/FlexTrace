export type TraceLevel = "info" | "warn" | "error";

export type TraceKind = "tool" | "skill" | "model" | "message" | "manual";

export type TraceStatus = "ok" | "error" | "unknown";

export type TraceRecord =
  | {
      type: "capture_start";
      captureId: string;
      ts: number;
      attrs?: Record<string, unknown>;
    }
  | {
      type: "capture_end";
      captureId: string;
      ts: number;
    }
  | {
      type: "session";
      op: "upsert";
      ts: number;
      sessionId: string;
      rootSessionId: string;
      parentSessionId?: string;
      label?: string;
      attrs?: Record<string, unknown>;
    }
  | {
      type: "task_start";
      ts: number;
      taskId: string;
      sessionId: string;
      rootSessionId: string;
      parentTaskId?: string;
      kind: TraceKind;
      name: string;
      attrs?: Record<string, unknown>;
    }
  | {
      type: "task_end";
      ts: number;
      taskId: string;
      sessionId: string;
      rootSessionId: string;
      status: TraceStatus;
      durationMs?: number;
      tokensIn?: number;
      tokensOut?: number;
      attrs?: Record<string, unknown>;
    }
  | {
      type: "tracepoint";
      ts: number;
      tpId: string;
      sessionId: string;
      rootSessionId: string;
      parentTaskId?: string;
      name: string;
      level: TraceLevel;
      attrs?: Record<string, unknown>;
      links?: Array<Record<string, unknown>>;
    }
  | {
      type: "marker";
      ts: number;
      label: string;
      sessionId: string;
      rootSessionId: string;
      attrs?: Record<string, unknown>;
    }
  | {
      type: "counter";
      ts: number;
      name: string;
      sessionId: string;
      rootSessionId: string;
      value: number;
      attrs?: Record<string, unknown>;
    };

export interface TraceUsage {
  promptTokens?: number;
  completionTokens?: number;
}
