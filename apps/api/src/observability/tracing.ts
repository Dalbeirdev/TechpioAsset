import { context as otelContext, trace, type Span } from '@opentelemetry/api';

/**
 * v2.8 S4 — distributed tracing, strictly opt-in.
 *
 * Written after the 2026-08-03 incident, where diagnosis was archaeology:
 * reading logs backwards to reconstruct what a request did. Spans make that a
 * lookup instead.
 *
 * Two deliberate properties:
 *
 * 1. **Nothing is constructed when OTEL_EXPORTER_OTLP_ENDPOINT is unset.** No
 *    SDK, no instrumentation patching, no exporter, no cost — the same opt-in
 *    discipline as every other provider in this codebase.
 * 2. **The correlation id becomes the trace id** (see request-context), so a
 *    log line and a trace are the same identifier rather than two things an
 *    operator has to join by timestamp at 3am.
 *
 * Must be started BEFORE the Nest application is created: instrumentation
 * works by patching modules as they load.
 */

const SERVICE_NAME = 'techpioasset-api';

export interface TracingHandle {
  shutdown: () => Promise<void>;
}

let started: TracingHandle | null = null;

export function isTracingEnabled(): boolean {
  return started !== null;
}

/**
 * Starts tracing if an OTLP endpoint is configured. Returns null when tracing
 * is off — the caller can log that plainly rather than implying it is on.
 */
export async function startTracing(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TracingHandle | null> {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return null;
  if (started) return started;

  // Imported lazily so an installation with tracing off never even loads the
  // SDK - "costs nothing when off" has to be true at require time too.
  const [{ NodeSDK }, { OTLPTraceExporter }, { HttpInstrumentation }, { ExpressInstrumentation }, { PrismaInstrumentation }, resources, semconv] =
    await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/instrumentation-http'),
      import('@opentelemetry/instrumentation-express'),
      import('@prisma/instrumentation'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
    ]);

  const sdk = new NodeSDK({
    resource: resources.resourceFromAttributes({
      [semconv.ATTR_SERVICE_NAME]: SERVICE_NAME,
      [semconv.ATTR_SERVICE_VERSION]: env.npm_package_version ?? '0.1.0',
      'deployment.environment': env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    }),
    instrumentations: [
      new HttpInstrumentation({
        // Health probes run every few seconds and would drown the useful traces.
        ignoreIncomingRequestHook: (request) =>
          Boolean(request.url?.startsWith('/health/')),
      }),
      new ExpressInstrumentation(),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
  started = {
    shutdown: async () => {
      await sdk.shutdown();
      started = null;
    },
  };
  return started;
}

/**
 * The active trace id, or null when tracing is off. Used by the request
 * context so a correlation id IS the trace id whenever one exists.
 */
export function activeTraceId(): string | null {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const { traceId } = span.spanContext();
  // All-zero means an invalid/non-recording context - not something to log.
  return /^0+$/.test(traceId) ? null : traceId;
}

/**
 * Starts a span for an incoming request and makes it the ACTIVE context for
 * everything the request goes on to do.
 *
 * Why this exists rather than relying on the HTTP auto-instrumentation: ESM
 * imports hoist, so `node:http` is already loaded by the time any application
 * code runs, and require-in-the-middle can only patch modules loaded AFTER
 * registration. Auto-instrumentation therefore misses the server span unless
 * the process is started with `--import` pointing at a tracing bootstrap.
 * Owning the request span makes the behaviour independent of how the process
 * was launched - and it is the span whose id becomes the request id, so it is
 * the one that must not be optional.
 *
 * Returns null when tracing is off; the caller falls back to its own id.
 */
export function startRequestSpan(
  name: string,
): { traceId: string; end: (statusCode: number) => void; runInContext: <T>(fn: () => T) => T } | null {
  if (!started) return null;
  const tracer = trace.getTracer(SERVICE_NAME);
  const span = tracer.startSpan(name);
  const { traceId } = span.spanContext();
  const ctx = trace.setSpan(otelContext.active(), span);
  return {
    traceId,
    end: (statusCode: number) => {
      span.setAttribute('http.status_code', statusCode);
      span.setStatus({ code: statusCode >= 500 ? 2 : 1 });
      span.end();
    },
    runInContext: <T>(fn: () => T): T => otelContext.with(ctx, fn),
  };
}

/**
 * Wraps work in a span when tracing is on, and is a plain call-through when it
 * is off - so background jobs can be instrumented without caring which.
 */
export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!started) return fn();
  const tracer = trace.getTracer(SERVICE_NAME);
  return tracer.startActiveSpan(name, async (span: Span) => {
    try {
      const result = await fn();
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'failed' });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
