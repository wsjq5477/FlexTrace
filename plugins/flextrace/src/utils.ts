import { randomUUID } from "node:crypto";

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /api[_-]?key["']?\s*[:=]\s*["'][^"']+["']/gi,
  /authorization["']?\s*[:=]\s*["'][^"']+["']/gi,
  /password["']?\s*[:=]\s*["'][^"']+["']/gi,
];

export function now(): number {
  return Date.now();
}

export function id(): string {
  return randomUUID();
}

export function safeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { value: String(err) };
}

export function safeStringify(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function redactSecrets(raw: string): string {
  let result = raw;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function preview(input: unknown, max = 800): string {
  const compact = redactSecrets(safeStringify(input));
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}
