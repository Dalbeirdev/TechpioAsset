import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';
import { runWithRequestContext } from '../request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Opens the ambient request context and stamps the response with its id.
 *
 * Spec section 24 requires request IDs; section 21 requires a correlation ID on
 * audit rows. A client-supplied correlation id is honoured so a mobile action and
 * the jobs it triggers can be traced as one unit, but the request id is always
 * server-generated - trusting a client for it would let callers collide log lines.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = `req_${ulid()}`;
    const incoming = req.header(CORRELATION_ID_HEADER);
    const correlationId =
      incoming && /^[A-Za-z0-9._-]{1,128}$/.test(incoming) ? incoming : requestId;

    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    runWithRequestContext(
      {
        requestId,
        correlationId,
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
        clientType: req.header('x-client-type'),
      },
      () => next(),
    );
  }
}
