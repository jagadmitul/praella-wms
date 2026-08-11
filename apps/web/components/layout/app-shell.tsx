'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { CurrentSession, Permission } from '@wms/contracts';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { cn } from '@/lib/cn';

/**
 * Responsive application shell.
 *
 * The navigation is a permanent column from `lg` upwards and a slide-over
 * drawer below it. Both render the same `Sidebar`, so there is one navigation
 * definition rather than a desktop copy and a mobile copy that drift apart.
 *
 * The drawer closes on navigation — without that, tapping a link on a phone
 * leaves the menu covering the page you just asked for.
 */
export function AppShell({
  session,
  signOut,
  children,
}: {
  session: CurrentSession;
  signOut: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // The drawer records the route it was opened on rather than a bare boolean,
  // so navigating away closes it as a consequence of the new pathname instead
  // of via an effect that fires a second render on every navigation.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const isNavOpen = openedOnPath === pathname;
  const setNavOpen = (open: boolean): void =>
    setOpenedOnPath(open ? pathname : null);

  // A drawer that scrolls the page behind it feels broken on touch devices.
  useEffect(() => {
    document.body.style.overflow = isNavOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isNavOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenedOnPath(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const organizationName =
    session.user.memberships.find(
      (membership) => membership.organizationId === session.activeOrganizationId,
    )?.organizationName ?? 'Your organisation';

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Permanent navigation from lg upwards. */}
      <div className="hidden lg:block">
        <Sidebar
          permissions={[...session.permissions] as Permission[]}
          organizationName={organizationName}
        />
      </div>

      {/* Slide-over drawer below lg. */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          isNavOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!isNavOpen}
      >
        <button
          type="button"
          tabIndex={isNavOpen ? 0 : -1}
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className={cn(
            'absolute inset-0 bg-ink-900/50 transition-opacity duration-200',
            isNavOpen ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 transition-transform duration-200 ease-out',
            isNavOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar
            permissions={[...session.permissions] as Permission[]}
            organizationName={organizationName}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar session={session} signOut={signOut} onOpenNav={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
