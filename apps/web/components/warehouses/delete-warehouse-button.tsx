'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { deleteWarehouseAction } from '@/lib/actions/inventory';
import { IDLE } from '@/lib/actions/types';
import { buttonClass } from '@/components/ui';

function Inner({ name }: { name: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass('secondary', 'px-2.5 py-1.5 text-xs')}
      aria-label={`Delete or archive ${name}`}
    >
      {pending ? '…' : 'Delete'}
    </button>
  );
}

/**
 * Deletes a warehouse — or archives it, if it carries stock history.
 *
 * The API makes that call, not the UI, so the resulting message is surfaced
 * verbatim rather than assumed: a user who clicks "Delete" and gets "archived
 * instead, the ledger is preserved" deserves to be told exactly that.
 */
export function DeleteWarehouseButton({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState(deleteWarehouseAction, IDLE);
  const [toast, setToast] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => {
    if (state.status === 'idle') return;

    setToast({
      tone: state.status === 'success' ? 'ok' : 'bad',
      text: state.message ?? '',
    });

    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              `Delete "${name}"? If it holds stock or has movement history it will be archived instead, so the ledger is preserved.`,
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="warehouseId" value={id} />
        <Inner name={name} />
      </form>

      {toast ? (
        <p
          role="status"
          className={
            toast.tone === 'ok'
              ? 'fixed right-6 bottom-6 z-50 max-w-md rounded-lg border border-positive-600/20 bg-positive-50 px-4 py-2.5 text-left text-sm text-positive-700 shadow-lg'
              : 'fixed right-6 bottom-6 z-50 max-w-md rounded-lg border border-danger-600/20 bg-danger-50 px-4 py-2.5 text-left text-sm text-danger-700 shadow-lg'
          }
        >
          {toast.text}
        </p>
      ) : null}
    </>
  );
}
