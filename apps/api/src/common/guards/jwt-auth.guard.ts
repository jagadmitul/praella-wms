import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators';

/**
 * Global authentication guard. Every route requires a valid access token unless
 * it is explicitly marked `@Public()`, so a new endpoint is protected by default
 * rather than by remembering to protect it.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return isPublic ? true : super.canActivate(context);
  }

  override handleRequest<TUser>(error: unknown, user: TUser): TUser {
    if (error || !user) {
      throw new UnauthorizedException('Missing or invalid access token');
    }
    return user;
  }
}
