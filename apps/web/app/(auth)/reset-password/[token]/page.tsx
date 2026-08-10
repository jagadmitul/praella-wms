import type { Metadata } from 'next';
import { TokenForm } from '@/components/auth/token-form';
import { confirmPasswordResetAction } from '@/lib/actions/account';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">
        Choose a new password
      </h1>
      <p className="mt-1 mb-6 text-sm text-ink-500">
        Setting a new password signs you out of every other device.
      </p>

      <TokenForm
        action={confirmPasswordResetAction}
        token={token}
        submitLabel="Update password"
        passwordLabel="New password"
      />
    </>
  );
}
