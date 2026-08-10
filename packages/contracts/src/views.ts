import type {
  BulkJobStatus,
  BulkJobType,
  MovementReferenceType,
  MovementType,
  PurchaseOrderStatus,
  Role,
  SalesOrderStatus,
  StockTransferStatus,
} from './enums';

/**
 * Response shapes returned by the API.
 *
 * These are plain interfaces rather than Zod schemas on purpose: they describe
 * what the server *produces*, and the server is the authority on that. Zod is
 * reserved for what the server *accepts*, where untrusted input has to be
 * validated. The web client imports these for end-to-end type safety.
 *
 * Money is serialised as a string (Postgres `Decimal`) so no precision is lost
 * crossing JSON.
 */

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface MemberView {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  joinedAt: string;
  /** Warehouses a STAFF member is restricted to. Empty for ADMIN/MANAGER. */
  warehouses: Array<{ id: string; name: string; code: string }>;
}

export interface WarehouseView {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Aggregates computed by the API so list screens need no extra round trip. */
  stats: {
    productCount: number;
    totalUnits: number;
    lowStockCount: number;
  };
}

export interface CategoryView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productCount: number;
}

export interface SupplierView {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  productCount: number;
}

export interface ProductStockBreakdown {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  isBelowThreshold: boolean;
}

export interface ProductView {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  defaultReorderPoint: number;
  defaultReorderQuantity: number;
  isActive: boolean;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  totalQuantity: number;
  totalReserved: number;
  totalAvailable: number;
  isBelowThreshold: boolean;
  stockByWarehouse: ProductStockBreakdown[];
  createdAt: string;
  updatedAt: string;
}

export interface StockLevelView {
  id: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  isBelowThreshold: boolean;
  product: { id: string; name: string; sku: string; unit: string; unitPrice: string };
  warehouse: { id: string; name: string; code: string };
  updatedAt: string;
}

export interface StockMovementView {
  id: string;
  type: MovementType;
  quantity: number;
  /** On-hand quantity in the affected warehouse immediately after this row. */
  balanceAfter: number;
  unitCost: string | null;
  note: string | null;
  referenceType: MovementReferenceType;
  referenceId: string | null;
  referenceCode: string | null;
  product: { id: string; name: string; sku: string };
  sourceWarehouse: { id: string; name: string; code: string } | null;
  destinationWarehouse: { id: string; name: string; code: string } | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface StockTransferView {
  id: string;
  code: string;
  /** Optimistic-concurrency token; echo it back when editing. */
  version: number;
  status: StockTransferStatus;
  notes: string | null;
  sourceWarehouse: { id: string; name: string; code: string };
  destinationWarehouse: { id: string; name: string; code: string };
  items: Array<{
    id: string;
    quantity: number;
    product: { id: string; name: string; sku: string };
  }>;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PurchaseOrderView {
  id: string;
  code: string;
  /** Optimistic-concurrency token; echo it back when editing. */
  version: number;
  status: PurchaseOrderStatus;
  notes: string | null;
  totalAmount: string;
  expectedAt: string | null;
  receivedAt: string | null;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string; code: string };
  items: Array<{
    id: string;
    quantity: number;
    receivedQuantity: number;
    outstandingQuantity: number;
    unitCost: string;
    lineTotal: string;
    product: { id: string; name: string; sku: string; unit: string };
  }>;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface SalesOrderView {
  id: string;
  code: string;
  /** Optimistic-concurrency token; echo it back when editing. */
  version: number;
  status: SalesOrderStatus;
  notes: string | null;
  totalAmount: string;
  customerName: string;
  customerEmail: string | null;
  fulfilledAt: string | null;
  warehouse: { id: string; name: string; code: string };
  items: Array<{
    id: string;
    quantity: number;
    fulfilledQuantity: number;
    outstandingQuantity: number;
    unitPrice: string;
    lineTotal: string;
    product: { id: string; name: string; sku: string; unit: string };
  }>;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface BulkJobView {
  id: string;
  type: BulkJobType;
  status: BulkJobStatus;
  totalLines: number;
  processedLines: number;
  failedLines: number;
  errors: Array<{ line: number; message: string }>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface LowStockItemView {
  productId: string;
  productName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
  reorderPoint: number;
  /** How many units short of the threshold this line currently is. */
  shortfall: number;
  suggestedOrderQuantity: number;
  supplier: { id: string; name: string } | null;
}

export interface DashboardSummaryView {
  warehouseCount: number;
  productCount: number;
  totalUnits: number;
  /** Sum of `quantity * unitPrice` across all stock levels in scope. */
  inventoryValue: string;
  lowStockCount: number;
  openPurchaseOrders: number;
  openSalesOrders: number;
  movementsLast7Days: number;
  recentMovements: StockMovementView[];
  topLowStock: LowStockItemView[];
  /** Units in and out per day for the last 14 days, oldest first. */
  movementTrend: Array<{ date: string; inbound: number; outbound: number }>;
}

export interface InvitationView {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  invitedBy: { id: string; fullName: string } | null;
  warehouses: Array<{ id: string; name: string; code: string }>;
  /**
   * The acceptance link. Returned only at creation time, because the raw token
   * is never stored — only its hash.
   */
  inviteUrl?: string;
}
