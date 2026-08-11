import 'server-only';
import { cache } from 'react';
import type {
  BulkJobView,
  CategoryView,
  CurrentSession,
  DashboardSummaryView,
  LowStockItemView,
  MemberView,
  Paginated,
  ProductView,
  PurchaseOrderView,
  SalesOrderView,
  StockLevelView,
  StockMovementView,
  StockTransferView,
  SupplierView,
  WarehouseView,
} from '@wms/contracts';
import { apiFetch, buildQuery } from './api';

/**
 * Typed read helpers.
 *
 * Every response type comes from `@wms/contracts`, the same package the API
 * uses to describe what it returns — so a change to a payload shape breaks the
 * build here rather than producing `undefined` on a page.
 */

export type ListParams = Record<string, string | number | boolean | undefined>;

/**
 * The signed-in user, their active organisation, role and permissions.
 *
 * Wrapped in React's `cache` so the dashboard layout and the page it renders
 * share one request instead of each making their own. That was two round trips
 * to the API on every single navigation — the single largest avoidable cost in
 * the app, and very visible once the API is a network hop away rather than
 * localhost.
 */
export const getSession = cache((): Promise<CurrentSession> =>
  apiFetch<CurrentSession>('/auth/me'),
);

export function getDashboard(): Promise<DashboardSummaryView> {
  return apiFetch<DashboardSummaryView>('/reports/dashboard');
}

export const getWarehouses = cache(
  (params: ListParams = {}): Promise<Paginated<WarehouseView>> =>
    apiFetch(`/warehouses${buildQuery({ pageSize: 100, ...params })}`),
);

export function getProducts(params: ListParams = {}): Promise<Paginated<ProductView>> {
  return apiFetch(`/products${buildQuery(params)}`);
}

export const getCategories = cache(
  (params: ListParams = {}): Promise<Paginated<CategoryView>> =>
    apiFetch(`/categories${buildQuery({ pageSize: 100, ...params })}`),
);

export const getSuppliers = cache(
  (params: ListParams = {}): Promise<Paginated<SupplierView>> =>
    apiFetch(`/suppliers${buildQuery({ pageSize: 100, ...params })}`),
);

export function getStockLevels(params: ListParams = {}): Promise<Paginated<StockLevelView>> {
  return apiFetch(`/stock/levels${buildQuery(params)}`);
}

export function getMovements(
  params: ListParams = {},
): Promise<Paginated<StockMovementView>> {
  return apiFetch(`/stock/movements${buildQuery(params)}`);
}

export function getLowStock(params: ListParams = {}): Promise<LowStockItemView[]> {
  return apiFetch(`/stock/low-stock${buildQuery(params)}`);
}

export function getTransfers(
  params: ListParams = {},
): Promise<Paginated<StockTransferView>> {
  return apiFetch(`/transfers${buildQuery(params)}`);
}

export function getPurchaseOrders(
  params: ListParams = {},
): Promise<Paginated<PurchaseOrderView>> {
  return apiFetch(`/purchase-orders${buildQuery(params)}`);
}

export function getSalesOrders(
  params: ListParams = {},
): Promise<Paginated<SalesOrderView>> {
  return apiFetch(`/sales-orders${buildQuery(params)}`);
}

export function getMembers(params: ListParams = {}): Promise<Paginated<MemberView>> {
  return apiFetch(`/organization/members${buildQuery({ pageSize: 100, ...params })}`);
}

export function getJobs(params: ListParams = {}): Promise<Paginated<BulkJobView>> {
  return apiFetch(`/jobs${buildQuery(params)}`);
}
