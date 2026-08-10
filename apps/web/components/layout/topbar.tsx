import type { CurrentSession } from '@wms/contracts';
import { ROLE_LABELS } from '@wms/contracts';
import { signOutAction } from '@/lib/actions/auth';
import { Badge, buttonClass } from '@/components/ui';

/**
 * Shows who is signed in, in which role, and — for a scoped staff member — how
 * many warehouses they can see. Making the scope visible saves the "why can't I
 * find the Mumbai stock?" support ticket.
 */
export function Topbar({ session }: { session: CurrentSession }) {
  const role = session.activeRole;
  const scopeCount = session.warehouseScope?.length ?? null;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6">
      <div className="flex items-center gap-2">
        {role ? (
          <Badge tone={role === 'ADMIN' ? 'brand' : role === 'MANAGER' ? 'positive' : 'neutral'}>
            {ROLE_LABELS[role]}
          </Badge>
        ) : null}
        {scopeCount !== null ? (
          <Badge tone="warning">
            Scoped to {scopeCount} warehouse{scopeCount === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm leading-tight font-medium text-ink-800">
            {session.user.fullName}
          </p>
          <p className="text-xs leading-tight text-ink-400">{session.user.email}</p>
        </div>

        <form action={signOutAction}>
          <button type="submit" className={buttonClass('secondary', 'px-2.5 py-1.5 text-xs')}>
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
