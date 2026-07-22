import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getRequestContext } from '../request-context.js';

/** Marker for payloads that are already enveloped (e.g. paginated results). */
export const ENVELOPE_PASSTHROUGH = Symbol('envelopePassthrough');

interface MaybeEnveloped {
  data?: unknown;
  meta?: Record<string, unknown>;
  [ENVELOPE_PASSTHROUGH]?: boolean;
}

/**
 * Wraps every successful response as `{ data, meta }` (spec section 24).
 *
 * Handlers return bare payloads; the envelope, request id and timestamp are added
 * here so no controller can forget them and clients never have to probe the shape.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((payload: unknown) => {
        const ctx = getRequestContext();
        const meta = {
          requestId: ctx?.requestId ?? 'req_unknown',
          timestamp: new Date().toISOString(),
        };

        // A handler that already produced { data, meta } (pagination, simulated
        // provider flags) keeps its meta and only gains the standard fields.
        if (payload !== null && typeof payload === 'object') {
          const candidate = payload as MaybeEnveloped;
          if ('data' in candidate && 'meta' in candidate) {
            return {
              data: candidate.data,
              meta: { ...meta, ...candidate.meta },
            };
          }
        }

        return { data: payload ?? null, meta };
      }),
    );
  }
}
