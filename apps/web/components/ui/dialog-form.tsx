'use client';

import { useActionToast } from '@/lib/use-action-toast';
import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { IDLE, type ActionState } from '@/lib/actions/types';
import { buttonClass, FormError } from './index';

/**
 * Field errors are published through context rather than a render prop.
 *
 * A render function cannot cross the server/client boundary, so `children` has
 * to be plain, already-created elements. Context lets those server-rendered
 * fields still read the client-side validation state.
 */
const FieldErrorContext = createContext<Record<string, string> | undefined>(undefined);

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={buttonClass('primary')}>
      {pending ? 'Saving…' : label}
    </button>
  );
}

/**
 * A modal form backed by a Server Action.
 *
 * Built on the native `<dialog>` element, which brings focus trapping, Escape
 * to close and inertness of the page behind it for free — all of which would
 * otherwise be a few hundred lines of accessibility work to reimplement badly.
 */
export function DialogForm({
  trigger,
  title,
  description,
  action,
  submitLabel,
  children,
}: {
  trigger: string;
  title: string;
  description?: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, IDLE);
  const result = useActionToast(state, 5000);
  // Only successes close the dialog and celebrate; an error has to stay on
  // screen next to the field that caused it.
  const toast = result?.tone === 'ok' ? (result.text || 'Saved.') : null;

  // Closing a <dialog> is an imperative DOM call, not state, so it belongs in
  // an effect — and unlike a setState it costs no extra render.
  useEffect(() => {
    if (state.status === 'success') dialogRef.current?.close();
  }, [state]);

  return (
    <>
      <button
        type="button"
        className={buttonClass('primary')}
        onClick={() => dialogRef.current?.showModal()}
      >
        {trigger}
      </button>

      {toast ? (
        <p
          role="status"
          className="fixed right-6 bottom-6 z-50 max-w-md rounded-lg border border-positive-600/20 bg-positive-50 px-4 py-2.5 text-sm text-positive-700 shadow-lg"
        >
          {toast}
        </p>
      ) : null}

      <dialog
        ref={dialogRef}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 backdrop:bg-ink-900/40"
        onClick={(event) => {
          // Clicking the backdrop (the dialog element itself) dismisses it.
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <form action={formAction} className="flex flex-col">
          <header className="border-b border-line px-5 py-4">
            <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-ink-500">{description}</p>
            ) : null}
          </header>

          <div className="space-y-4 px-5 py-5">
            {state.status === 'error' ? <FormError message={state.message} /> : null}
            <FieldErrorContext value={state.fieldErrors}>{children}</FieldErrorContext>
          </div>

          <footer className="flex justify-end gap-2 border-t border-line bg-surface-sunken px-5 py-3">
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <SubmitButton label={submitLabel} />
          </footer>
        </form>
      </dialog>
    </>
  );
}

/**
 * Renders the inline validation message for one field, if the last submission
 * produced one.
 *
 * @param name - The field's form name, matching the schema key.
 */
export function FieldError({ name }: { name: string }) {
  const fieldErrors = useContext(FieldErrorContext);
  const message = fieldErrors?.[name];

  if (!message) return null;

  return <p className="mt-1 text-xs text-danger-700">{message}</p>;
}
