import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/auth/auth-form';
import { signUpAction } from '@/lib/actions/auth';

export const metadata: Metadata = { title: 'Create an organisation' };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">
        Create your organisation
      </h1>
      <p className="mt-1 mb-6 text-sm text-ink-500">
        You will be its first administrator, with full access.
      </p>

      <AuthForm
        action={signUpAction}
        submitLabel="Create organisation"
        fields={[
          {
            name: 'fullName',
            label: 'Your name',
            placeholder: 'Aarav Mehta',
            autoComplete: 'name',
          },
          {
            name: 'organizationName',
            label: 'Organisation name',
            placeholder: 'Praella Supply Co',
            autoComplete: 'organization',
          },
          {
            name: 'email',
            label: 'Work email',
            type: 'email',
            placeholder: 'you@company.com',
            autoComplete: 'email',
          },
          {
            name: 'password',
            label: 'Password',
            type: 'password',
            hint: '— 10+ characters, with upper, lower and a digit',
            autoComplete: 'new-password',
          },
        ]}
      />

      <p className="mt-6 text-sm text-ink-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </>
  );
}
