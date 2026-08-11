import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '@wms/contracts';
import { permissionsForRole } from '@wms/contracts';
import { AppShell } from './app-shell';

const pathname = vi.fn(() => '/products');

vi.mock('next/navigation', () => ({
  usePathname: () => pathname(),
}));

/**
 * The mobile drawer derives its open state from the route it was opened on,
 * rather than closing itself from an effect that watches the pathname. These
 * tests pin the behaviour that refactor has to preserve — in particular that
 * navigating away closes it, which is the whole reason the effect existed.
 */
describe('AppShell navigation drawer', () => {
  const session = {
    user: {
      id: 'u1',
      email: 'manager@praella-wms.dev',
      fullName: 'Diya Sharma',
      memberships: [
        {
          organizationId: 'org1',
          organizationName: 'Praella Supply Co',
          role: 'MANAGER',
        },
      ],
    },
    activeOrganizationId: 'org1',
    activeRole: 'MANAGER',
    permissions: [...permissionsForRole('MANAGER')],
    warehouseScope: null,
  } as unknown as CurrentSession;

  const renderShell = () =>
    render(
      <AppShell session={session} signOut={<button>Sign out</button>}>
        <p>Page body</p>
      </AppShell>,
    );

  beforeEach(() => {
    pathname.mockReturnValue('/products');
    document.body.style.overflow = '';
  });

  /** The overlay is hidden from assistive tech while the drawer is shut. */
  const drawer = () => screen.getByLabelText('Close navigation').parentElement;

  it('starts closed', () => {
    renderShell();

    expect(drawer()).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens from the top bar and locks the page behind it', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByLabelText('Open navigation'));

    expect(drawer()).toHaveAttribute('aria-hidden', 'false');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByLabelText('Open navigation'));
    await user.keyboard('{Escape}');

    expect(drawer()).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes when the route changes', async () => {
    const user = userEvent.setup();
    const view = renderShell();

    await user.click(screen.getByLabelText('Open navigation'));
    expect(drawer()).toHaveAttribute('aria-hidden', 'false');

    // A drawer left open over the page the user just navigated to is the bug
    // this behaviour exists to prevent.
    pathname.mockReturnValue('/warehouses');
    view.rerender(
      <AppShell session={session} signOut={<button>Sign out</button>}>
        <p>Page body</p>
      </AppShell>,
    );

    expect(drawer()).toHaveAttribute('aria-hidden', 'true');
    expect(document.body.style.overflow).toBe('');
  });
});
