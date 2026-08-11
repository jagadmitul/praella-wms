import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from '@/components/ui';
import { Pagination } from '@/components/ui/filters';
import { getJobs } from '@/lib/queries';
import { formatDateTime, formatNumber, humanise } from '@/lib/format';

export const metadata: Metadata = { title: 'Background jobs' };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string ; pageSize?: string; sortBy?: string; sortDir?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  const pageSize = Math.min(Number(params.pageSize ?? 20) || 20, 100);
  const jobs = await getJobs({ page, pageSize });

  return (
    <>
      <PageHeader
        title="Background jobs"
        description="Bulk stock work runs on a queue rather than inside the HTTP request. Lines are applied in chunked transactions, and a bad line fails only itself."
      />

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Status</Th>
              <Th align="right">Lines</Th>
              <Th align="right">Applied</Th>
              <Th align="right">Failed</Th>
              <Th>Queued</Th>
              <Th>Errors</Th>
            </tr>
          </thead>
          <tbody>
            {jobs.items.length === 0 ? (
              <EmptyState
                colSpan={7}
                title="No background jobs yet"
                description="Queue one via POST /api/v1/jobs/bulk-stock-adjustments."
              />
            ) : (
              jobs.items.map((job) => (
                <tr key={job.id}>
                  <Td>
                    <p className="text-ink-700">{humanise(job.type)}</p>
                    <p className="font-mono text-[11px] text-ink-400">
                      {job.id.slice(0, 12)}
                    </p>
                  </Td>
                  <Td>
                    <StatusBadge status={job.status} />
                  </Td>
                  <Td align="right">{formatNumber(job.totalLines)}</Td>
                  <Td align="right" className="text-positive-700">
                    {formatNumber(job.processedLines)}
                  </Td>
                  <Td align="right">
                    {job.failedLines > 0 ? (
                      <span className="text-danger-700">
                        {formatNumber(job.failedLines)}
                      </span>
                    ) : (
                      <span className="text-ink-300">0</span>
                    )}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-ink-500">
                    {formatDateTime(job.createdAt)}
                  </Td>
                  <Td>
                    {job.errors.length === 0 ? (
                      <span className="text-xs text-ink-300">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {job.errors.slice(0, 3).map((error) => (
                          <li key={error.line} className="text-[11px] text-ink-500">
                            Line {error.line}: {error.message}
                          </li>
                        ))}
                        {job.errors.length > 3 ? (
                          <li className="text-[11px] text-ink-400">
                            +{job.errors.length - 3} more
                          </li>
                        ) : null}
                      </ul>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>

        <Pagination
          page={jobs.meta.page}
          totalPages={jobs.meta.totalPages}
          totalItems={jobs.meta.totalItems}
          pageSize={pageSize}
        />
      </Card>
    </>
  );
}
