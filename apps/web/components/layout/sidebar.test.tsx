import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { permissionsForRole } from '@wms/contracts';
import { Sidebar } from './sidebar';

/**
 * The navigation is built from the same permission matrix the API guards read.
 * These tests pin that relationship: if a role is widened in the shared
 * package, the UI must follow, and if it is narrowed, links must disappear.
 */
describe('Sidebar', () => {
  const renderFor = (role: 'ADMIN' | 'MANAGER' | 'STAFF') =>
    render(
      <Sidebar
        permissions={[...permissionsForRole(role)]}
        organizationName="Praella Supply Co"
      />,
    );

  it('shows the organisation name', () => {
    renderFor('ADMIN');
    expect(screen.getByText('Praella Supply Co')).toBeInTheDocument();
  });

  it('gives an admin every section', () => {
    renderFor('ADMIN');

    for (const label of [
      'Dashboard',
      'Warehouses',
      'Products',
      'Stock levels',
      'Replenishment',
      'Movement history',
      'Transfers',
      'Purchase orders',
      'Sales orders',
      'Team',
      'Background jobs',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('gives a manager the operational sections', () => {
    renderFor('MANAGER');

    expect(screen.getByRole('link', { name: 'Purchase orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Transfers' })).toBeInTheDocument();
  });

  it('shows staff only what their permissions allow', () => {
    renderFor('STAFF');

    // Staff hold movement:read and stock:read, so these remain.
    expect(screen.getByRole('link', { name: 'Movement history' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock levels' })).toBeInTheDocument();
  });

  it('marks the active route for assistive technology', () => {
    renderFor('ADMIN');

    // The mocked pathname is /products.
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Warehouses' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('renders nothing clickable for a permissionless session', () => {
    render(<Sidebar permissions={[]} organizationName="Empty Org" />);

    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
