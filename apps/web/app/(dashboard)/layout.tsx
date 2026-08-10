import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { getSession } from '@/lib/queries';

/**
 * Authenticated shell. The session is fetched once here and the permission list
 * drives the navigation, so every page below can assume a signed-in user.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const organizationName =
    session.user.memberships.find(
      (membership) => membership.organizationId === session.activeOrganizationId,
    )?.organizationName ?? 'Your organisation';

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        permissions={[...session.permissions]}
        organizationName={organizationName}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar session={session} />
        <main className="flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
