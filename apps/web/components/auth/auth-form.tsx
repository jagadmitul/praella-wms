'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AuthFormState } from '@/lib/actions/auth';
import { buttonClass, FormError, Label } from '@/components/ui';

interface FieldDefinition {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={buttonClass('primary', 'w-full')}>
      {pending ? 'Please wait…' : label}
    </button>
  );
}

/**
 * Shared sign-in / sign-up form.
 *
 * The action runs on the server, so the password is posted straight to a Server
 * Action and the resulting tokens are written to `httpOnly` cookies there. No
 * credential ever passes through client-side state.
 */
export function AuthForm({
  action,
  fields,
  submitLabel,
  redirectTo,
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  fields: FieldDefinition[];
  submitLabel: string;
  redirectTo?: string;
}) {
  const [state, formAction] = useActionState(action, {} as AuthFormState);

  return (
    <form action={formAction} className="space-y-4">
      {redirectTo ? <input type="hidden" name="from" value={redirectTo} /> : null}

      <FormError message={state.error} />

      {fields.map((field) => (
        <div key={field.name}>
          <Label htmlFor={field.name} hint={field.hint}>
            {field.label}
          </Label>
          <input
            id={field.name}
            name={field.name}
            type={field.type ?? 'text'}
            placeholder={field.placeholder}
            autoComplete={field.autoComplete}
            className="field"
            aria-invalid={state.fieldErrors?.[field.name] ? 'true' : undefined}
            aria-describedby={
              state.fieldErrors?.[field.name] ? `${field.name}-error` : undefined
            }
          />
          {state.fieldErrors?.[field.name] ? (
            <p id={`${field.name}-error`} className="mt-1 text-xs text-danger-700">
              {state.fieldErrors[field.name]}
            </p>
          ) : null}
        </div>
      ))}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
