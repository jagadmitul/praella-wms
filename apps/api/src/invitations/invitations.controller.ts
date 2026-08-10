import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  type InvitationPreview,
  type InvitationView,
} from '@wms/contracts';
import {
  CurrentOrg,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import { InvitationsService } from './invitations.service';

class CreateInvitationDto extends createZodDto(createInvitationSchema) {}
class AcceptInvitationDto extends createZodDto(acceptInvitationSchema) {}

@ApiTags('Invitations')
@ApiBearerAuth('access-token')
@Controller('organization/invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get()
  @RequirePermissions('member:read')
  @ApiOperation({ summary: 'List invitations' })
  async list(@CurrentOrg() orgContext: OrgContext): Promise<InvitationView[]> {
    return this.invitationsService.list(orgContext);
  }

  @Post()
  @RequirePermissions('member:invite')
  @ApiOperation({
    summary: 'Invite a collaborator by email (admin only)',
    description:
      'Issues a single-use link that expires in 7 days. No account or membership is created until the invitee accepts. The response includes the acceptance URL because the raw token is never stored — only its hash.',
  })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateInvitationDto,
  ): Promise<InvitationView> {
    return this.invitationsService.create(orgContext, user.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('member:invite')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revoke(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.invitationsService.revoke(orgContext, user.id, id);
  }
}

/**
 * The public half of the flow. These routes are reachable without a token,
 * because the whole point is that the invitee does not have an account yet.
 */
@ApiTags('Invitations')
@Controller('invitations')
export class PublicInvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({
    summary: 'Preview an invitation',
    description:
      'Returns who invited whom, so the acceptance page can be rendered before asking for a password. Every failure mode returns the same 404, so the endpoint cannot be used to probe for valid tokens.',
  })
  async preview(@Param('token') token: string): Promise<InvitationPreview> {
    return this.invitationsService.preview(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an invitation and set a password',
    description:
      'Role and warehouse scope come from the stored invitation, not the request, so an invitee cannot escalate their own privileges.',
  })
  async accept(@Body() body: AcceptInvitationDto): Promise<{ email: string }> {
    return this.invitationsService.accept(body.token, body.password);
  }
}
