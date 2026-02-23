import type { TraceKind } from "./trace_record.js";

export interface TaskFrame {
  taskId: string;
  kind: TraceKind;
  name: string;
  startedAt: number;
}

export class TaskContext {
  private readonly stackBySession = new Map<string, TaskFrame[]>();

  push(sessionId: string, frame: TaskFrame): void {
    const stack = this.stackBySession.get(sessionId) ?? [];
    stack.push(frame);
    this.stackBySession.set(sessionId, stack);
  }

  pop(sessionId: string, taskId: string): TaskFrame | undefined {
    const stack = this.stackBySession.get(sessionId);
    if (!stack?.length) return undefined;

    const top = stack[stack.length - 1];
    if (top.taskId === taskId) return stack.pop();

    const idx = stack.findIndex((item) => item.taskId === taskId);
    if (idx < 0) return undefined;
    return stack.splice(idx, 1)[0];
  }

  current(sessionId: string): TaskFrame | undefined {
    const stack = this.stackBySession.get(sessionId);
    return stack?.[stack.length - 1];
  }

  clear(sessionId: string): void {
    this.stackBySession.delete(sessionId);
  }
}
