import type { ReactNode } from 'react';
import type { CurrentSession } from '@wms/contracts';
import { ROLE_LABELS } from '@wms/contracts';
import { Badge } from '@/components/ui';

/**
 * Shows who is signed in, in which role, and — for a scoped staff member — how
 * many warehouses they can see. Making the scope visible saves the "why can't I
 * find the Mumbai stock?" support ticket.
 *
 * The sign-out control is passed in as a slot so this stays a Server Component
 * while the surrounding shell handles the mobile drawer on the client.
 */
export function Topbar({
  session,
  signOut,
  onOpenNav,
}: {
  session: CurrentSession;
  signOut: ReactNode;
  onOpenNav?: () => void;
}) {
  const role = session.activeRole;
  const scopeCount = session.warehouseScope?.length ?? null;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-1 rounded-lg p-2 text-ink-500 transition-colors hover:bg-surface-sunken hover:text-ink-800 lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {role ? (
          <Badge
            tone={role === 'ADMIN' ? 'brand' : role === 'MANAGER' ? 'positive' : 'neutral'}
          >
            {ROLE_LABELS[role]}
          </Badge>
        ) : null}

        {scopeCount !== null ? (
          <Badge tone="warning" className="hidden sm:inline-flex">
            Scoped to {scopeCount} warehouse{scopeCount === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <div className="hidden min-w-0 text-right sm:block">
          <p className="truncate text-sm leading-tight font-medium text-ink-800">
            {session.user.fullName}
          </p>
          <p className="truncate text-xs leading-tight text-ink-400">
            {session.user.email}
          </p>
        </div>
        {signOut}
      </div>
    </header>
  );
}
