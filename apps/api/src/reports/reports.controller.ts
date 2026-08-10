import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DashboardSummaryView } from '@wms/contracts';
import { CurrentOrg, RequirePermissions } from '../common/decorators';
import type { OrgContext } from '../common/types/request-context';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions('report:read')
  @ApiOperation({
    summary: 'Dashboard summary',
    description:
      'Headline counts, inventory valuation, a 14-day movement trend, the most recent ledger entries and the most urgent low-stock lines — all scoped to the warehouses the caller can see.',
  })
  @ApiOkResponse({ description: 'Dashboard summary' })
  async dashboard(@CurrentOrg() orgContext: OrgContext): Promise<DashboardSummaryView> {
    return this.reportsService.dashboard(orgContext);
  }
}
