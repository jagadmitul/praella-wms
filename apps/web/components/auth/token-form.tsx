'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { IDLE, type ActionState } from '@/lib/actions/types';
import { buttonClass, FormError, Label } from '@/components/ui';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={buttonClass('primary', 'w-full')}>
      {pending ? 'Please wait…' : label}
    </button>
  );
}

/**
 * Shared form for the token-bearing account flows: accepting an invitation and
 * completing a password reset. Both are "prove you hold this token, then choose
 * a password", so they share one component rather than two near-copies.
 */
export function TokenForm({
  action,
  token,
  submitLabel,
  passwordLabel = 'Choose a password',
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  token: string;
  submitLabel: string;
  passwordLabel?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      {state.status === 'error' ? <FormError message={state.message} /> : null}

      <div>
        <Label htmlFor="password" hint="— 10+ characters, with upper, lower and a digit">
          {passwordLabel}
        </Label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          className="field"
          aria-invalid={state.fieldErrors?.password ? 'true' : undefined}
        />
        {state.fieldErrors?.password ? (
          <p className="mt-1 text-xs text-danger-700">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      <SubmitButton label={submitLabel} />
    </form>
  );
}

/** Simple email form used to request a reset link. */
export function RequestResetForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, IDLE);

  if (state.status === 'success') {
    return (
      <p
        role="status"
        className="rounded-lg border border-positive-600/20 bg-positive-50 px-3 py-2.5 text-sm text-positive-700"
      >
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.status === 'error' ? <FormError message={state.message} /> : null}

      <div>
        <Label htmlFor="email">Email address</Label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          className="field"
          placeholder="you@company.com"
        />
        {state.fieldErrors?.email ? (
          <p className="mt-1 text-xs text-danger-700">{state.fieldErrors.email}</p>
        ) : null}
      </div>

      <SubmitButton label="Send reset link" />
    </form>
  );
}
