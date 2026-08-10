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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { CurrentOrg, CurrentUser, RequirePermissions } from '../common/decorators';
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
  async current(@CurrentOrg() orgContext: OrgContext): Promise<OrganizationView> {
    return this.organizationsService.current(orgContext);
  }

  @Patch()
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Rename the organisation (admin only)' })
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
    description: 'Shows each member’s role and, for staff, their assigned warehouses.',
  })
  async listMembers(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: MemberQueryDto,
  ): Promise<Paginated<MemberView>> {
    return this.organizationsService.listMembers(orgContext, query);
  }

  @Post('members')
  @RequirePermissions('member:invite')
  @ApiOperation({
    summary: 'Add a collaborator (admin only)',
    description:
      'Links an existing account by email, or creates one with the supplied temporary password. Staff can be scoped to specific warehouses at the same time.',
  })
  async inviteMember(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: InviteMemberDto,
  ): Promise<MemberView> {
    return this.organizationsService.inviteMember(orgContext, user.id, body);
  }

  @Patch('members/:membershipId')
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Change a member’s role or warehouse assignments (admin only)' })
  async updateMember(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('membershipId') membershipId: string,
    @Body() body: UpdateMemberDto,
  ): Promise<MemberView> {
    return this.organizationsService.updateMember(orgContext, user.id, membershipId, body);
  }

  @Delete('members/:membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Remove a collaborator (admin only)' })
  async removeMember(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('membershipId') membershipId: string,
  ): Promise<void> {
    await this.organizationsService.removeMember(orgContext, user.id, membershipId);
  }
}
