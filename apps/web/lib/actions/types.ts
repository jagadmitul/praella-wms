/**
 * Form state shared by every Server Action.
 *
 * Kept in its own module because a `'use server'` file may only export async
 * functions — exporting the `IDLE` constant from there makes Next refuse to
 * compile the module at all.
 */
export interface ActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Initial state passed to `useActionState`. */
export const IDLE: ActionState = { status: 'idle' };
