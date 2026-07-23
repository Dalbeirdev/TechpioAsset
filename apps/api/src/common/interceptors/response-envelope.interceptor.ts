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
        // File downloads set their own Content-Type / Content-Disposition and
        // must not be wrapped — enveloping a CSV would corrupt the download.
        // A handler signals this by setting a non-JSON content type before
        // returning its body.
        const response = context.switchToHttp().getResponse<{
          getHeader?: (name: string) => unknown;
          headersSent?: boolean;
        }>();
        // A handler that manages the response itself (a redirect, a stream) has
        // already sent headers; never try to envelope over it.
        if (response.headersSent) {
          return payload;
        }
        const disposition = response.getHeader?.('content-disposition');
        if (typeof disposition === 'string' && disposition.includes('attachment')) {
          return payload;
        }

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
