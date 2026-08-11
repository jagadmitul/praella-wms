'use client';

import { useEffect, useState } from 'react';
import type { ActionState } from '@/lib/actions/types';

export interface ActionToast {
  tone: 'ok' | 'bad';
  text: string;
}

/**
 * Derives a transient toast from the result of a Server Action.
 *
 * The toast is computed during render rather than copied into state by an
 * effect. Copying it meant every action result caused a second render pass
 * purely to mirror data the component already had — the cascade React's
 * `set-state-in-effect` rule exists to catch.
 *
 * State is still needed for dismissal, but only to remember *which* result was
 * dismissed, and it is written from a timer callback rather than from the
 * effect body.
 *
 * `useActionState` returns a fresh object per submission, so identity is a
 * reliable marker: submitting again produces a new object and the toast returns
 * even when the message is unchanged.
 *
 * @param state - The action state returned by `useActionState`.
 * @param ttlMs - How long the toast stays on screen.
 * @returns The toast to render, or `null` when there is nothing to show.
 */
export function useActionToast(
  state: ActionState,
  ttlMs = 5_000,
): ActionToast | null {
  const [dismissed, setDismissed] = useState<ActionState | null>(null);

  useEffect(() => {
    if (state.status === 'idle') return;

    const timer = setTimeout(() => setDismissed(state), ttlMs);
    return () => clearTimeout(timer);
  }, [state, ttlMs]);

  if (state.status === 'idle' || dismissed === state) return null;

  return {
    tone: state.status === 'success' ? 'ok' : 'bad',
    text: state.message ?? '',
  };
}
