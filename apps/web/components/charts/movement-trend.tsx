import type { DashboardSummaryView } from '@wms/contracts';
import { formatNumber } from '@/lib/format';

/**
 * Fourteen-day inbound/outbound trend, drawn as inline SVG.
 *
 * A charting library would be several hundred kilobytes of client JavaScript
 * for one small figure; this renders on the server, ships no JS at all, and
 * stays legible when scaled. Bars are paired rather than stacked because the
 * question being answered is "did more go out than came in today?", which a
 * stacked bar actively obscures.
 */
export function MovementTrend({
  data,
}: {
  data: DashboardSummaryView['movementTrend'];
}) {
  const peak = Math.max(1, ...data.flatMap((day) => [day.inbound, day.outbound]));
  const totalIn = data.reduce((sum, day) => sum + day.inbound, 0);
  const totalOut = data.reduce((sum, day) => sum + day.outbound, 0);

  const chartHeight = 140;
  const slotWidth = 100 / data.length;
  const barWidth = slotWidth * 0.32;

  return (
    <div className="px-5 py-5">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="flex items-center gap-2 text-xs text-ink-500">
          <span aria-hidden className="size-2 rounded-xs bg-positive-600" />
          Inbound
          <span className="font-medium text-ink-800 tabular">{formatNumber(totalIn)}</span>
        </span>
        <span className="flex items-center gap-2 text-xs text-ink-500">
          <span aria-hidden className="size-2 rounded-xs bg-brand-500" />
          Outbound
          <span className="font-medium text-ink-800 tabular">
            {formatNumber(totalOut)}
          </span>
        </span>
      </div>

      <svg
        viewBox={`0 0 100 ${chartHeight}`}
        preserveAspectRatio="none"
        className="h-36 w-full"
        role="img"
        aria-label={`Stock movement over the last ${data.length} days: ${formatNumber(totalIn)} units inbound, ${formatNumber(totalOut)} units outbound.`}
      >
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2="100"
            y1={chartHeight - chartHeight * fraction}
            y2={chartHeight - chartHeight * fraction}
            stroke="var(--color-line)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {data.map((day, index) => {
          const slotStart = index * slotWidth;
          const inboundHeight = (day.inbound / peak) * (chartHeight - 8);
          const outboundHeight = (day.outbound / peak) * (chartHeight - 8);

          return (
            <g key={day.date}>
              <rect
                x={slotStart + slotWidth * 0.16}
                y={chartHeight - inboundHeight}
                width={barWidth}
                height={inboundHeight}
                fill="var(--color-positive-600)"
                rx="0.6"
              />
              <rect
                x={slotStart + slotWidth * 0.52}
                y={chartHeight - outboundHeight}
                width={barWidth}
                height={outboundHeight}
                fill="var(--color-brand-500)"
                rx="0.6"
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex justify-between text-[10px] text-ink-300">
        <span>
          {data[0]
            ? new Date(data[0].date).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              })
            : ''}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
