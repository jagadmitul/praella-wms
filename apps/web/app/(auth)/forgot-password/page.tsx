import type { Metadata } from 'next';
import Link from 'next/link';
import { RequestResetForm } from '@/components/auth/token-form';
import { requestPasswordResetAction } from '@/lib/actions/account';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">
        Reset your password
      </h1>
      <p className="mt-1 mb-6 text-sm text-ink-500">
        We will send a link to your email address if an account exists for it.
      </p>

      <RequestResetForm action={requestPasswordResetAction} />

      <p className="mt-6 text-sm text-ink-500">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </>
  );
}
