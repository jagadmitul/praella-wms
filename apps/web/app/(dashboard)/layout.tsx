import { AppShell } from '@/components/layout/app-shell';
import { buttonClass } from '@/components/ui';
import { signOutAction } from '@/lib/actions/auth';
import { getSession } from '@/lib/queries';

/**
 * Authenticated shell. The session is fetched once here and its permission list
 * drives the navigation, so every page below can assume a signed-in user.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  // Rendered here so the sign-out Server Action stays on the server side of the
  // boundary, and handed to the client shell as a slot.
  const signOut = (
    <form action={signOutAction}>
      <button
        type="submit"
        className={buttonClass('secondary', 'px-2.5 py-1.5 text-xs whitespace-nowrap')}
      >
        Sign out
      </button>
    </form>
  );

  return (
    <AppShell session={session} signOut={signOut}>
      {children}
    </AppShell>
  );
}
