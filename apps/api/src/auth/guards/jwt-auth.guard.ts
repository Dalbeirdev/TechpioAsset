import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { withActor } from '../../common/request-context.js';
import { AuthService } from '../auth.service.js';
import { TokenService } from '../token.service.js';
import { IS_PUBLIC_KEY } from '../decorators.js';

/**
 * Authenticates the bearer token and populates both `request.user` and the
 * ambient request context.
 *
 * Registered globally, so routes are protected unless explicitly marked @Public.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    }

    const claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());

    // Re-resolved from the database rather than trusted from the token body.
    // Spec section 20: never trust role or permission values submitted by the
    // frontend - and a JWT is submitted by the frontend. The claims are used only
    // to identify the subject; authority always comes from current state.
    const user = await this.auth.buildAuthUser(claims.sub);

    request.user = user;
    withActor({ userId: user.id, companyId: user.companyId });
    return true;
  }
}
