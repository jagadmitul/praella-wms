import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type {
  BulkJobView,
  CreateBulkStockJobInput,
  Paginated,
  PaginationQuery,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, toPrismaPage } from '../common/utils/pagination.util';
import type { OrgContext } from '../common/types/request-context';
import type { BulkJob } from '../generated/prisma/client';
import {
  BULK_STOCK_ADJUSTMENT_JOB,
  BULK_STOCK_QUEUE,
  type BulkStockJobPayload,
} from './jobs.constants';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    // Optional as a safety net: the module is only loaded when Redis is
    // enabled, but this keeps the service constructible in unit tests that do
    // not stand up a queue.
    @Optional()
    @InjectQueue(BULK_STOCK_QUEUE)
    private readonly bulkStockQueue: Queue<BulkStockJobPayload> | undefined,
  ) {}

  /**
   * Queues a bulk stock adjustment and returns immediately with a job record
   * the client can poll.
   *
   * The HTTP request does not wait for the work: a 20 000-line correction takes
   * minutes, and holding a connection open for that long is how you get gateway
   * timeouts and duplicate submissions from impatient users.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User submitting the job.
   * @param input - The lines to apply.
   * @returns The queued job record.
   * @throws ServiceUnavailableException when queues are disabled.
   */
  async enqueueBulkStockAdjustment(
    orgContext: OrgContext,
    actorId: string,
    input: CreateBulkStockJobInput,
  ): Promise<BulkJobView> {
    if (!this.bulkStockQueue) {
      throw new ServiceUnavailableException(
        'Background queues are disabled (REDIS_ENABLED=false). Start Redis to submit bulk jobs.',
      );
    }

    const job = await this.prisma.bulkJob.create({
      data: {
        organizationId: orgContext.organizationId,
        type: 'BULK_STOCK_ADJUSTMENT',
        status: 'QUEUED',
        totalLines: input.lines.length,
        createdById: actorId,
      },
    });

    await this.bulkStockQueue.add(
      BULK_STOCK_ADJUSTMENT_JOB,
      {
        bulkJobId: job.id,
        organizationId: orgContext.organizationId,
        actorId,
        lines: input.lines,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 3_600, count: 100 },
        removeOnFail: { age: 86_400 },
      },
    );

    return JobsService.toView(job);
  }

  /**
   * Lists background jobs for the organisation.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination options.
   * @returns A page of jobs, newest first.
   */
  async list(
    orgContext: OrgContext,
    query: PaginationQuery,
  ): Promise<Paginated<BulkJobView>> {
    const where = { organizationId: orgContext.organizationId };

    const [rows, totalItems] = await Promise.all([
      this.prisma.bulkJob.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.bulkJob.count({ where }),
    ]);

    return paginate(
      rows.map((row) => JobsService.toView(row)),
      totalItems,
      query,
    );
  }

  /**
   * Loads one job so a client can poll its progress.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Job identifier.
   * @returns The job record.
   */
  async findOne(orgContext: OrgContext, id: string): Promise<BulkJobView> {
    const job = await this.prisma.bulkJob.findFirst({
      where: { id, organizationId: orgContext.organizationId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return JobsService.toView(job);
  }

  private static toView(job: BulkJob): BulkJobView {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      totalLines: job.totalLines,
      processedLines: job.processedLines,
      failedLines: job.failedLines,
      errors: Array.isArray(job.errors)
        ? (job.errors as Array<{ line: number; message: string }>)
        : [],
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }
}
