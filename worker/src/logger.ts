// Single-line JSON logs, so `docker logs` output can be grepped and parsed
// without multi-line stack traces interleaving between entries.

type Level = "info" | "warn" | "error";

function serialize(value: unknown): unknown {
  return value instanceof Error ? `${value.name}: ${value.message}` : value;
}

function write(level: Level, msg: string, fields: Record<string, unknown>) {
  const entry: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
  for (const [key, value] of Object.entries(fields)) entry[key] = serialize(value);
  const line = JSON.stringify(entry);
  if (level === "info") console.log(line);
  else console.error(line);
}

export const log = {
  info: (msg: string, fields: Record<string, unknown> = {}) => write("info", msg, fields),
  warn: (msg: string, fields: Record<string, unknown> = {}) => write("warn", msg, fields),
  error: (msg: string, fields: Record<string, unknown> = {}) => write("error", msg, fields),
};
