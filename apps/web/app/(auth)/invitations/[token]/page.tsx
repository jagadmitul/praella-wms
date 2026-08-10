import type { Metadata } from 'next';
import Link from 'next/link';
import type { InvitationPreview } from '@wms/contracts';
import { TokenForm } from '@/components/auth/token-form';
import { acceptInvitationAction } from '@/lib/actions/account';
import { API_BASE_URL } from '@/lib/api';
import { Badge } from '@/components/ui';

export const metadata: Metadata = { title: 'Accept invitation' };

/**
 * Public acceptance page.
 *
 * The preview is fetched server-side so an expired or already-used link shows a
 * clear message instead of a form that would fail on submit.
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const response = await fetch(`${API_BASE_URL}/invitations/${token}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          This invitation is no longer valid
        </h1>
        <p className="mt-2 mb-6 text-sm text-ink-500">
          The link may have expired, already been used, or been revoked. Ask an
          administrator to send a new one.
        </p>
        <Link href="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          Back to sign in
        </Link>
      </>
    );
  }

  const invitation = (await response.json()) as InvitationPreview;

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">
        Join {invitation.organizationName}
      </h1>
      <p className="mt-1 mb-5 text-sm text-ink-500">
        Invited as <span className="font-medium text-ink-700">{invitation.email}</span>
      </p>

      <div className="mb-6 flex items-center gap-2">
        <Badge tone="brand">{invitation.role}</Badge>
        <span className="text-xs text-ink-400">
          Expires {new Date(invitation.expiresAt).toLocaleDateString('en-IN')}
        </span>
      </div>

      <TokenForm
        action={acceptInvitationAction}
        token={token}
        submitLabel="Accept and create account"
      />

      <p className="mt-6 text-xs text-ink-400">
        Your role and warehouse access were set by the person who invited you and cannot
        be changed here.
      </p>
    </>
  );
}
