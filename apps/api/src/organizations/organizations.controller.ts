import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  MemberListResponse,
  MemberResponse,
  OrganizationResponse,
} from '../common/dto/response.dto';
import { createZodDto } from 'nestjs-zod';
import {
  inviteMemberSchema,
  memberQuerySchema,
  updateMemberSchema,
  updateOrganizationSchema,
  type MemberView,
  type OrganizationView,
  type Paginated,
} from '@wms/contracts';
import {
  ApiErrors,
  CurrentOrg,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import { OrganizationsService } from './organizations.service';

class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}
class InviteMemberDto extends createZodDto(inviteMemberSchema) {}
class UpdateMemberDto extends createZodDto(updateMemberSchema) {}
class MemberQueryDto extends createZodDto(memberQuerySchema) {}

@ApiTags('Organisation & members')
@ApiBearerAuth('access-token')
@Controller('organization')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @RequirePermissions('org:read')
  @ApiOperation({ summary: 'Get the active organisation' })
  @ApiOkResponse({ type: OrganizationResponse })
  async current(
    @CurrentOrg() orgContext: OrgContext,
  ): Promise<OrganizationView> {
    return this.organizationsService.current(orgContext);
  }

  @Patch()
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Rename the organisation (admin only)' })
  @ApiOkResponse({ type: OrganizationResponse })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: UpdateOrganizationDto,
  ): Promise<OrganizationView> {
    return this.organizationsService.update(orgContext, user.id, body);
  }

  @Get('members')
  @RequirePermissions('member:read')
  @ApiOperation({
    summary: 'List collaborators',
    description:
      'Shows each member’s role and, for staff, their assigned warehouses.',
  })
  @ApiOkResponse({ type: MemberListResponse })
  async listMembers(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: MemberQueryDto,
  ): Promise<Paginated<MemberView>> {
    return this.organizationsService.listMembers(orgContext, query);
  }

  @Post('members')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('member:invite')
  @ApiOperation({
    summary: 'Add a collaborator (admin only)',
    description:
      'Links an existing account by email, or creates one with the supplied temporary password. Staff can be scoped to specific warehouses at the same time.',
  })
  @ApiCreatedResponse({ type: MemberResponse })
  async inviteMember(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: InviteMemberDto,
  ): Promise<MemberView> {
    return this.organizationsService.inviteMember(orgContext, user.id, body);
  }

  @Patch('members/:membershipId')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('member:manage')
  @ApiOperation({
    summary: 'Change a member’s role or warehouse assignments (admin only)',
  })
  @ApiOkResponse({ type: MemberResponse })
  async updateMember(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('membershipId') membershipId: string,
    @Body() body: UpdateMemberDto,
  ): Promise<MemberView> {
    return this.organizationsService.updateMember(
      orgContext,
      user.id,
      membershipId,
      body,
    );
  }

  @Delete('members/:membershipId')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Membership removed.' })
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Remove a collaborator (admin only)' })
  async removeMember(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('membershipId') membershipId: string,
  ): Promise<void> {
    await this.organizationsService.removeMember(
      orgContext,
      user.id,
      membershipId,
    );
  }
}
