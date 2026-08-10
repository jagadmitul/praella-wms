import { createZodDto } from 'nestjs-zod';
import { refreshTokenSchema, signInSchema, signUpSchema } from '@wms/contracts';

/**
 * DTOs are generated from the shared Zod schemas, so validation rules and the
 * OpenAPI document are derived from one definition that the web client also
 * imports. There is no second copy of the rules to fall out of sync.
 */
export class SignUpDto extends createZodDto(signUpSchema) {}
export class SignInDto extends createZodDto(signInSchema) {}
export class RefreshTokenDto extends createZodDto(refreshTokenSchema) {}
