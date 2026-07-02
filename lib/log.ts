import { randomUUID } from "crypto";

// Structured single-line JSON logger.
// Emits to stdout so Vercel/Cloud logs collect them.
//
// trace_id resolution order:
//   1. Sentry active span (if @sentry/nextjs is initialized)
//   2. Random UUID fallback
//
// Usage:
//   log("api.start", { route: "/api/foo" });
//   log("api.end", { route: "/api/foo", latency_ms: 42, status: 200 });

let sentryLoaded: typeof import("@sentry/nextjs") | null = null;
try {
  // Lazy require to avoid pulling Sentry into edge bundles that don't need it.
  // Sentry is optional — if not configured, we simply skip trace_id from spans.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sentryLoaded = require("@sentry/nextjs");
} catch {
  sentryLoaded = null;
}

function currentTraceId(): string {
  try {
    if (sentryLoaded) {
      const span =
        typeof sentryLoaded.getActiveSpan === "function"
          ? sentryLoaded.getActiveSpan()
          : null;
      if (span && typeof span.spanContext === "function") {
        const ctx = span.spanContext();
        if (ctx && typeof ctx.traceId === "string" && ctx.traceId.length > 0) {
          return ctx.traceId;
        }
      }
    }
  } catch {
    // fall through to UUID
  }
  return randomUUID();
}

export function log(event: string, data: Record<string, unknown> = {}): void {
  const line = {
    ts: new Date().toISOString(),
    event,
    trace_id: currentTraceId(),
    ...data,
  };
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  } catch {
    // If something in `data` isn't JSON-serializable, fall back to a safe form
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: line.ts,
        event,
        trace_id: line.trace_id,
        error: "log_serialize_failed",
      })
    );
  }
}

// Helper: wraps an API handler so start/end are logged automatically.
// Returns whatever the handler returns.
export async function withApiLog<T>(
  route: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  log("api.start", { route });
  try {
    const res = await fn();
    const status =
      res && typeof res === "object" && "status" in res
        ? (res as { status?: number }).status
        : undefined;
    log("api.end", {
      route,
      latency_ms: Date.now() - start,
      status,
    });
    return res;
  } catch (err) {
    log("api.end", {
      route,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
