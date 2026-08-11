'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import type { Permission } from '@wms/contracts';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  /** Hidden unless the signed-in role holds this permission. */
  permission: Permission;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAVIGATION: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/', label: 'Dashboard', permission: 'report:read' }],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/warehouses', label: 'Warehouses', permission: 'warehouse:read' },
      { href: '/products', label: 'Products', permission: 'product:read' },
      { href: '/inventory', label: 'Stock levels', permission: 'stock:read' },
      { href: '/low-stock', label: 'Replenishment', permission: 'replenishment:read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/movements', label: 'Movement history', permission: 'movement:read' },
      { href: '/transfers', label: 'Transfers', permission: 'stock:read' },
      {
        href: '/purchase-orders',
        label: 'Purchase orders',
        permission: 'purchase_order:read',
      },
      { href: '/sales-orders', label: 'Sales orders', permission: 'sales_order:read' },
    ],
  },
  {
    label: 'Organisation',
    items: [
      { href: '/team', label: 'Team', permission: 'member:read' },
      { href: '/jobs', label: 'Background jobs', permission: 'job:read' },
    ],
  },
];

/**
 * Shows a spinner inside the link the user just clicked.
 *
 * `useLinkStatus` reports the pending state of the enclosing Link, which ties
 * the indicator to the item that was actually clicked rather than showing a
 * generic global bar.
 */
function LinkSpinner() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      aria-hidden
      className="ml-auto size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white/80"
    />
  );
}

/**
 * Primary navigation.
 *
 * Items are filtered by the permission list the API returned for this session,
 * using the same `Permission` union the guards check. The UI therefore cannot
 * offer a link to something the API would answer with a 403.
 */
export function Sidebar({
  permissions,
  organizationName,
}: {
  permissions: Permission[];
  organizationName: string;
}) {
  const pathname = usePathname();
  const granted = new Set(permissions);

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-900 lg:w-60"
    >
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-xs font-bold text-white"
        >
          W
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{organizationName}</p>
          <p className="text-[11px] text-white/40">Warehouse OS</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {NAVIGATION.map((group) => {
          const visible = group.items.filter((item) => granted.has(item.permission));
          if (visible.length === 0) return null;

          return (
            <div key={group.label} className="mb-5">
              <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-white/30 uppercase">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {visible.map((item) => {
                  const isActive =
                    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
                          isActive
                            ? 'bg-white/10 font-medium text-white'
                            : 'text-white/55 hover:bg-white/5 hover:text-white/85',
                        )}
                      >
                        {item.label}
                        <LinkSpinner />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
