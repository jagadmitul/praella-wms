import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A small, hand-rolled component set.
 *
 * Rolled by hand rather than pulled from shadcn/ui because this dashboard needs
 * roughly eight primitives, and vendoring a component library plus Radix for
 * that would add far more surface area than it saves. Everything here is
 * server-renderable — only the handful of genuinely interactive pieces opt into
 * `'use client'`.
 */

/* --------------------------------- Layout -------------------------------- */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn('card', className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-ink-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-ink-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

/* --------------------------------- Badges -------------------------------- */

type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-ink-500 ring-line-strong',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  positive: 'bg-positive-50 text-positive-700 ring-positive-600/20',
  warning: 'bg-warning-50 text-warning-700 ring-warning-600/20',
  danger: 'bg-danger-50 text-danger-700 ring-danger-600/20',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps a document status onto a colour, so status reads at a glance. */
export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = (
    {
      DRAFT: 'neutral',
      SUBMITTED: 'brand',
      ALLOCATED: 'brand',
      IN_TRANSIT: 'brand',
      PARTIALLY_RECEIVED: 'warning',
      PARTIALLY_FULFILLED: 'warning',
      QUEUED: 'neutral',
      PROCESSING: 'brand',
      RECEIVED: 'positive',
      FULFILLED: 'positive',
      COMPLETED: 'positive',
      COMPLETED_WITH_ERRORS: 'warning',
      CANCELLED: 'danger',
      FAILED: 'danger',
    } as Record<string, Tone>
  )[status] ?? 'neutral';

  return <Badge tone={tone}>{status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

/* --------------------------------- Tables -------------------------------- */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-line bg-surface-sunken px-4 py-2.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <td
      className={cn(
        'border-b border-line px-4 py-3 align-middle text-ink-700',
        align === 'right' && 'text-right tabular',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function EmptyState({
  title,
  description,
  colSpan,
}: {
  title: string;
  description?: string;
  colSpan: number;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        <p className="text-sm font-medium text-ink-700">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-400">{description}</p>
        ) : null}
      </td>
    </tr>
  );
}

/* ---------------------------------- Stats -------------------------------- */

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="card px-5 py-4">
      <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
        {label}
      </p>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold tracking-tight tabular',
          tone === 'warning' && 'text-warning-700',
          tone === 'danger' && 'text-danger-700',
          tone === 'positive' && 'text-positive-700',
          (tone === 'neutral' || tone === 'brand') && 'text-ink-900',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

/* --------------------------------- Buttons ------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600 disabled:bg-brand-600/50',
  secondary:
    'bg-surface text-ink-700 ring-1 ring-inset ring-line-strong hover:bg-surface-sunken focus-visible:outline-brand-600',
  ghost: 'text-ink-500 hover:bg-surface-sunken hover:text-ink-800',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 focus-visible:outline-danger-600 disabled:bg-danger-600/50',
};

/** Shared button styling, used by both links and real buttons. */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  className?: string,
): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-60',
    BUTTON_CLASSES[variant],
    className,
  );
}

/* ---------------------------------- Forms -------------------------------- */

export function Label({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink-700">
      {children}
      {hint ? <span className="ml-1 font-normal text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-lg border border-danger-600/20 bg-danger-50 px-3 py-2 text-sm text-danger-700"
    >
      {message}
    </p>
  );
}
