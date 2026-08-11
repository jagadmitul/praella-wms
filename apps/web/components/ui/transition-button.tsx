'use client';

import { useActionToast } from '@/lib/use-action-toast';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { documentTransitionAction } from '@/lib/actions/inventory';
import { IDLE } from '@/lib/actions/types';
import { buttonClass } from './index';

function Inner({ label, variant }: { label: string; variant: 'primary' | 'secondary' | 'danger' }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant, 'px-2.5 py-1.5 text-xs')}
    >
      {pending ? '…' : label}
    </button>
  );
}

/**
 * Advances a document to its next state — dispatch, receive, allocate, fulfil,
 * cancel.
 *
 * The button is only rendered when the caller has the permission for it, and
 * the API checks the same permission again, so this is a convenience rather
 * than the security boundary.
 */
export function TransitionButton({
  resource,
  id,
  transition,
  label,
  variant = 'secondary',
  confirm,
}: {
  resource: 'transfers' | 'purchase-orders' | 'sales-orders';
  id: string;
  transition: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  confirm?: string;
}) {
  const [state, formAction] = useActionState(documentTransitionAction, IDLE);
  const toast = useActionToast(state, 5000);

  return (
    <>
      <form
        action={formAction}
        className="inline"
        onSubmit={(event) => {
          if (confirm && !window.confirm(confirm)) event.preventDefault();
        }}
      >
        <input type="hidden" name="resource" value={resource} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="transition" value={transition} />
        <Inner label={label} variant={variant} />
      </form>

      {toast ? (
        <p
          role="status"
          className={
            toast.tone === 'ok'
              ? 'fixed right-6 bottom-6 z-50 rounded-lg border border-positive-600/20 bg-positive-50 px-4 py-2.5 text-sm text-positive-700 shadow-lg'
              : 'fixed right-6 bottom-6 z-50 max-w-md rounded-lg border border-danger-600/20 bg-danger-50 px-4 py-2.5 text-sm text-danger-700 shadow-lg'
          }
        >
          {toast.text}
        </p>
      ) : null}
    </>
  );
}
