import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthSession, AuthTokens, CurrentSession } from '@wms/contracts';
import { CurrentUser, Public, SkipOrgContext } from '../common/decorators';
import type {
  MaybeAuthenticatedRequest,
  RequestUser,
} from '../common/types/request-context';
import { AuthService } from './auth.service';
import { TokenService, type TokenClientInfo } from './token.service';
import { RefreshTokenDto, SignInDto, SignUpDto } from './dto/auth.dto';
import { createZodDto } from 'nestjs-zod';
import {
  confirmPasswordResetSchema,
  requestPasswordResetSchema,
} from '@wms/contracts';
import { PasswordResetService } from './password-reset.service';

class RequestPasswordResetDto extends createZodDto(requestPasswordResetSchema) {}
class ConfirmPasswordResetDto extends createZodDto(confirmPasswordResetSchema) {}

/**
 * Sign-up and sign-in are far tighter than the global limit — they are the
 * endpoints worth brute-forcing. Read from the environment so the limit can be
 * tuned per deployment (and raised by the integration suite, which makes dozens
 * of legitimate sign-ins a second).
 */
const AUTH_THROTTLE = {
  default: {
    limit: Number(process.env.AUTH_THROTTLE_LIMIT ?? 10),
    ttl: 60_000,
  },
};

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('sign-up')
  @ApiOperation({
    summary: 'Register a user and create their organisation',
    description:
      'Creates the user, an organisation, and an ADMIN membership linking them, then returns a token pair.',
  })
  @ApiBody({ type: SignUpDto })
  @ApiCreatedResponse({ description: 'Account created and signed in' })
  async signUp(
    @Body() body: SignUpDto,
    @Req() request: MaybeAuthenticatedRequest,
  ): Promise<AuthSession> {
    return this.authService.signUp(body, AuthController.clientInfo(request));
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody({ type: SignInDto })
  @ApiOkResponse({ description: 'Signed in' })
  async signIn(
    @Body() body: SignInDto,
    @Req() request: MaybeAuthenticatedRequest,
  ): Promise<AuthSession> {
    return this.authService.signIn(body, AuthController.clientInfo(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'Rotates the refresh token. Presenting an already-rotated token revokes every session for that user.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({ description: 'New token pair issued' })
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: MaybeAuthenticatedRequest,
  ): Promise<AuthTokens> {
    return this.tokenService.rotate(body.refreshToken, AuthController.clientInfo(request));
  }

  @Public()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiBody({ type: RefreshTokenDto })
  async signOut(@Body() body: RefreshTokenDto): Promise<void> {
    await this.tokenService.revoke(body.refreshToken);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password-reset/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Request a password-reset link',
    description:
      'Always returns 204, whether or not the address exists — an endpoint that 404s on unknown emails is a free account-enumeration oracle.',
  })
  @ApiBody({ type: RequestPasswordResetDto })
  async requestPasswordReset(@Body() body: RequestPasswordResetDto): Promise<void> {
    await this.passwordResetService.request(body.email);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password using a reset token',
    description: 'Consumes the token and revokes every active session for that user.',
  })
  @ApiBody({ type: ConfirmPasswordResetDto })
  async confirmPasswordReset(@Body() body: ConfirmPasswordResetDto): Promise<void> {
    await this.passwordResetService.confirm(body.token, body.password);
  }

  @SkipOrgContext()
  @Get('me')
  @ApiOperation({
    summary: 'Current user, active organisation and resolved permissions',
    description:
      'The web client renders its navigation from the returned permission list, so the UI can never offer an action the API would reject.',
  })
  @ApiOkResponse({ description: 'Current session' })
  async me(
    @CurrentUser() user: RequestUser,
    @Req() request: MaybeAuthenticatedRequest,
  ): Promise<CurrentSession> {
    return this.authService.currentSession(user.id, request.orgContext);
  }

  @SkipOrgContext()
  @Post('sign-out-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every active session for the current user' })
  async signOutAll(@CurrentUser() user: RequestUser): Promise<void> {
    await this.tokenService.revokeAllForUser(user.id);
  }

  /** Extracts user agent and client IP for the stored session record. */
  private static clientInfo(request: MaybeAuthenticatedRequest): TokenClientInfo {
    return {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    };
  }
}
