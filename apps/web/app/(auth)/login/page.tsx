import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/auth/auth-form';
import { signInAction } from '@/lib/actions/auth';

export const metadata: Metadata = { title: 'Sign in' };

const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@praella-wms.dev', scope: 'Everything' },
  { role: 'Manager', email: 'manager@praella-wms.dev', scope: 'No deletes, no members' },
  { role: 'Staff', email: 'staff@praella-wms.dev', scope: 'Surat hub only' },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; reason?: string }>;
}) {
  const { from, reason } = await searchParams;

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-ink-500">
        {reason === 'expired'
          ? 'Your session expired. Please sign in again.'
          : 'Welcome back. Enter your details to continue.'}
      </p>

      <AuthForm
        action={signInAction}
        submitLabel="Sign in"
        redirectTo={from}
        fields={[
          {
            name: 'email',
            label: 'Email address',
            type: 'email',
            placeholder: 'you@company.com',
            autoComplete: 'email',
          },
          {
            name: 'password',
            label: 'Password',
            type: 'password',
            placeholder: '••••••••••',
            autoComplete: 'current-password',
          },
        ]}
      />

      <p className="mt-6 text-sm text-ink-500">
        Need an organisation?{' '}
        <Link href="/signup" className="font-medium text-brand-600 hover:text-brand-700">
          Create one
        </Link>
      </p>

      <div className="mt-8 rounded-xl border border-line bg-surface-sunken p-4">
        <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
          Seeded demo accounts
        </p>
        <ul className="mt-3 space-y-2">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email} className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-xs text-ink-700">{account.email}</span>
              <span className="shrink-0 text-[11px] text-ink-400">{account.role}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-400">
          Password for all seeded accounts: <span className="font-mono">Praella@2026</span>
        </p>
      </div>
    </>
  );
}
