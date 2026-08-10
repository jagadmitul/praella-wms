import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  MovementReferenceType,
  MovementType,
  PurchaseOrderStatus,
  Role,
  SalesOrderStatus,
  StockTransferStatus,
} from '../src/generated/prisma/enums';

/**
 * Seeds a realistic, self-consistent demo organisation.
 *
 * The important property here is that the seed does not invent stock numbers:
 * it generates a chronological ledger of movements and derives every stock
 * level from that ledger. So the sum of a product's movements in a warehouse
 * always equals its on-hand quantity — exactly the invariant the application
 * maintains at runtime, and the one the tests assert.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Praella@2026';
const DAYS_OF_HISTORY = 30;

/** Deterministic PRNG so every `db:seed` run produces byte-identical data. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const random = createRandom(20260810);

/** Returns an integer in `[min, max]` inclusive. */
function randomInt(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Picks a random element from a non-empty array. */
function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)]!;
}

/** Returns a date `daysAgo` days before now, at a randomised working hour. */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(randomInt(4, 14), randomInt(0, 59), randomInt(0, 59), 0);
  return date;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** In-memory running balance for one (product, warehouse) pair. */
interface LedgerKey {
  productId: string;
  warehouseId: string;
}

type MovementDraft = {
  organizationId: string;
  productId: string;
  type: MovementType;
  quantity: number;
  balanceAfter: number;
  unitCost: string | null;
  note: string | null;
  referenceType: MovementReferenceType;
  referenceId: string | null;
  referenceCode: string | null;
  warehouseId: string;
  counterpartWarehouseId: string | null;
  createdById: string | null;
  createdAt: Date;
};

class Ledger {
  private readonly balances = new Map<string, number>();
  readonly movements: MovementDraft[] = [];

  constructor(private readonly organizationId: string) {}

  private static key({ productId, warehouseId }: LedgerKey): string {
    return `${productId}::${warehouseId}`;
  }

  balanceOf(key: LedgerKey): number {
    return this.balances.get(Ledger.key(key)) ?? 0;
  }

  /**
   * Applies a signed quantity to a (product, warehouse) balance and appends the
   * matching ledger row. Returns the resulting balance.
   */
  apply(params: {
    key: LedgerKey;
    type: MovementType;
    quantity: number;
    createdAt: Date;
    createdById: string;
    referenceType: MovementReferenceType;
    referenceId?: string | null;
    referenceCode?: string | null;
    unitCost?: string | null;
    note?: string | null;
    /** Counterpart warehouse for transfers, recorded on the same row. */
    counterpartWarehouseId?: string | null;
  }): number {
    const isInbound =
      params.type === MovementType.INBOUND || params.type === MovementType.TRANSFER_IN;
    const delta = isInbound ? params.quantity : -params.quantity;
    const next = this.balanceOf(params.key) + delta;
    this.balances.set(Ledger.key(params.key), next);

    this.movements.push({
      organizationId: this.organizationId,
      productId: params.key.productId,
      type: params.type,
      quantity: params.quantity,
      balanceAfter: next,
      unitCost: params.unitCost ?? null,
      note: params.note ?? null,
      referenceType: params.referenceType,
      referenceId: params.referenceId ?? null,
      referenceCode: params.referenceCode ?? null,
      warehouseId: params.key.warehouseId,
      counterpartWarehouseId: params.counterpartWarehouseId ?? null,
      createdById: params.createdById,
      createdAt: params.createdAt,
    });

    return next;
  }

  /** Every (product, warehouse) pair that ended with a non-zero balance. */
  entries(): Array<{ key: LedgerKey; quantity: number }> {
    return [...this.balances.entries()].map(([composite, quantity]) => {
      const [productId, warehouseId] = composite.split('::');
      return { key: { productId: productId!, warehouseId: warehouseId! }, quantity };
    });
  }
}

async function resetDatabase(): Promise<void> {
  // Ordered by dependency so the truncate never trips a foreign key.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs, bulk_jobs, document_counters,
      sales_order_items, sales_orders,
      purchase_order_items, purchase_orders,
      stock_transfer_items, stock_transfers,
      stock_movements, stock_levels,
      products, suppliers, categories,
      warehouse_members, warehouses,
      refresh_tokens, memberships,
      organizations, users
    RESTART IDENTITY CASCADE;
  `);
}

interface ProductSeed {
  name: string;
  sku: string;
  category: string;
  supplier: string;
  unitPrice: number;
  unit: string;
  reorderPoint: number;
  reorderQuantity: number;
}

const PRODUCT_SEEDS: ProductSeed[] = [
  { name: 'Aurora 27" 4K Monitor', sku: 'ELEC-MON-27', category: 'Electronics', supplier: 'Shenzhen Vertex Electronics', unitPrice: 24999.0, unit: 'pcs', reorderPoint: 25, reorderQuantity: 60 },
  { name: 'Aurora Wireless Keyboard', sku: 'ELEC-KBD-01', category: 'Electronics', supplier: 'Shenzhen Vertex Electronics', unitPrice: 3499.5, unit: 'pcs', reorderPoint: 60, reorderQuantity: 150 },
  { name: 'Aurora Ergonomic Mouse', sku: 'ELEC-MOU-02', category: 'Electronics', supplier: 'Shenzhen Vertex Electronics', unitPrice: 1899.0, unit: 'pcs', reorderPoint: 80, reorderQuantity: 200 },
  { name: 'Pulse USB-C 100W Charger', sku: 'ELEC-CHG-100', category: 'Electronics', supplier: 'Shenzhen Vertex Electronics', unitPrice: 2799.0, unit: 'pcs', reorderPoint: 70, reorderQuantity: 180 },
  { name: 'Pulse Bluetooth Earbuds', sku: 'ELEC-AUD-05', category: 'Electronics', supplier: 'Shenzhen Vertex Electronics', unitPrice: 4599.0, unit: 'pcs', reorderPoint: 50, reorderQuantity: 120 },
  { name: 'Nimbus 1TB Portable SSD', sku: 'ELEC-SSD-1T', category: 'Electronics', supplier: 'Shenzhen Vertex Electronics', unitPrice: 8999.0, unit: 'pcs', reorderPoint: 30, reorderQuantity: 80 },

  { name: 'Meridian Cotton Crew Tee', sku: 'APP-TEE-CRW', category: 'Apparel', supplier: 'Tirupur Knitwear Mills', unitPrice: 799.0, unit: 'pcs', reorderPoint: 200, reorderQuantity: 500 },
  { name: 'Meridian Oxford Shirt', sku: 'APP-SHT-OXF', category: 'Apparel', supplier: 'Tirupur Knitwear Mills', unitPrice: 1899.0, unit: 'pcs', reorderPoint: 120, reorderQuantity: 300 },
  { name: 'Meridian Chino Trousers', sku: 'APP-TRS-CHN', category: 'Apparel', supplier: 'Tirupur Knitwear Mills', unitPrice: 2299.0, unit: 'pcs', reorderPoint: 90, reorderQuantity: 220 },
  { name: 'Trailhead Merino Socks', sku: 'APP-SOC-MER', category: 'Apparel', supplier: 'Tirupur Knitwear Mills', unitPrice: 649.0, unit: 'pair', reorderPoint: 250, reorderQuantity: 600 },
  { name: 'Trailhead Rain Shell', sku: 'APP-JKT-RAI', category: 'Apparel', supplier: 'Tirupur Knitwear Mills', unitPrice: 4499.0, unit: 'pcs', reorderPoint: 60, reorderQuantity: 150 },

  { name: 'Hearth Cast Iron Skillet 10"', sku: 'HOME-SKL-10', category: 'Home & Kitchen', supplier: 'Rajkot Metalworks', unitPrice: 2199.0, unit: 'pcs', reorderPoint: 40, reorderQuantity: 100 },
  { name: 'Hearth Stainless Stockpot 8L', sku: 'HOME-POT-8L', category: 'Home & Kitchen', supplier: 'Rajkot Metalworks', unitPrice: 3299.0, unit: 'pcs', reorderPoint: 35, reorderQuantity: 90 },
  { name: 'Hearth Chef Knife 8"', sku: 'HOME-KNF-08', category: 'Home & Kitchen', supplier: 'Rajkot Metalworks', unitPrice: 1799.0, unit: 'pcs', reorderPoint: 55, reorderQuantity: 140 },
  { name: 'Lumen Ceramic Dinner Set', sku: 'HOME-DIN-16', category: 'Home & Kitchen', supplier: 'Khurja Ceramics House', unitPrice: 5499.0, unit: 'set', reorderPoint: 25, reorderQuantity: 60 },
  { name: 'Lumen Stoneware Mug', sku: 'HOME-MUG-ST', category: 'Home & Kitchen', supplier: 'Khurja Ceramics House', unitPrice: 449.0, unit: 'pcs', reorderPoint: 300, reorderQuantity: 700 },
  { name: 'Lumen Glass Storage Jar 1L', sku: 'HOME-JAR-1L', category: 'Home & Kitchen', supplier: 'Khurja Ceramics House', unitPrice: 599.0, unit: 'pcs', reorderPoint: 180, reorderQuantity: 400 },

  { name: 'Corrugated Box 12x9x6', sku: 'PKG-BOX-1296', category: 'Packaging', supplier: 'Vapi Packaging Solutions', unitPrice: 34.5, unit: 'pcs', reorderPoint: 2000, reorderQuantity: 5000 },
  { name: 'Corrugated Box 18x12x10', sku: 'PKG-BOX-181210', category: 'Packaging', supplier: 'Vapi Packaging Solutions', unitPrice: 62.0, unit: 'pcs', reorderPoint: 1500, reorderQuantity: 4000 },
  { name: 'Kraft Packing Tape 48mm', sku: 'PKG-TAP-48', category: 'Packaging', supplier: 'Vapi Packaging Solutions', unitPrice: 89.0, unit: 'roll', reorderPoint: 400, reorderQuantity: 1200 },
  { name: 'Bubble Wrap Roll 1m x 100m', sku: 'PKG-BUB-100', category: 'Packaging', supplier: 'Vapi Packaging Solutions', unitPrice: 1249.0, unit: 'roll', reorderPoint: 60, reorderQuantity: 180 },
  { name: 'Thermal Shipping Label 4x6', sku: 'PKG-LBL-46', category: 'Packaging', supplier: 'Vapi Packaging Solutions', unitPrice: 0.9, unit: 'pcs', reorderPoint: 10000, reorderQuantity: 25000 },
];

const CATEGORY_SEEDS = [
  { name: 'Electronics', description: 'Consumer electronics and computer peripherals' },
  { name: 'Apparel', description: 'Clothing and soft goods' },
  { name: 'Home & Kitchen', description: 'Cookware, tableware and home essentials' },
  { name: 'Packaging', description: 'Shipping and fulfilment consumables' },
];

const SUPPLIER_SEEDS = [
  { name: 'Shenzhen Vertex Electronics', contactName: 'Li Wei', email: 'orders@vertex-electronics.example', phone: '+86 755 8123 4567', address: 'Bao\'an District, Shenzhen, Guangdong, China' },
  { name: 'Tirupur Knitwear Mills', contactName: 'Anand Krishnan', email: 'sales@tirupurknit.example', phone: '+91 421 224 8890', address: 'Palladam Road, Tirupur, Tamil Nadu 641604, India' },
  { name: 'Rajkot Metalworks', contactName: 'Bhavesh Trivedi', email: 'bhavesh@rajkotmetal.example', phone: '+91 281 246 1122', address: 'Aji GIDC, Rajkot, Gujarat 360003, India' },
  { name: 'Khurja Ceramics House', contactName: 'Sunita Verma', email: 'contact@khurjaceramics.example', phone: '+91 573 225 4433', address: 'Pottery Road, Khurja, Uttar Pradesh 203131, India' },
  { name: 'Vapi Packaging Solutions', contactName: 'Nikhil Desai', email: 'nikhil@vapipack.example', phone: '+91 260 240 7788', address: 'GIDC Phase II, Vapi, Gujarat 396195, India' },
];

const WAREHOUSE_SEEDS = [
  { name: 'Surat Central Hub', code: 'SRT-HUB', addressLine1: 'Plot 44, Sachin GIDC', city: 'Surat', state: 'Gujarat', country: 'India', postalCode: '394230', notes: 'Primary inbound hub for all supplier deliveries.' },
  { name: 'Mumbai Distribution Centre', code: 'BOM-DC', addressLine1: 'Unit 7, Bhiwandi Logistics Park', city: 'Bhiwandi', state: 'Maharashtra', country: 'India', postalCode: '421302', notes: 'Serves western-region ecommerce dispatch.' },
  { name: 'Bengaluru Spoke', code: 'BLR-SPK', addressLine1: 'Warehouse 3, Nelamangala', city: 'Bengaluru', state: 'Karnataka', country: 'India', postalCode: '562123', notes: 'Southern-region spoke replenished from Surat.' },
];

async function main(): Promise<void> {
  console.log('› Resetting database…');
  await resetDatabase();

  const passwordHash = await argon2.hash(SEED_PASSWORD, { type: argon2.argon2id });

  /* ------------------------------ Organisation ----------------------------- */

  console.log('› Creating organisation, users and memberships…');
  const organization = await prisma.organization.create({
    data: { name: 'Praella Supply Co', slug: 'praella-supply-co' },
  });

  const [admin, manager, staffSurat, staffMumbai] = await Promise.all([
    prisma.user.create({ data: { email: 'admin@praella-wms.dev', fullName: 'Aarav Mehta', passwordHash } }),
    prisma.user.create({ data: { email: 'manager@praella-wms.dev', fullName: 'Diya Sharma', passwordHash } }),
    prisma.user.create({ data: { email: 'staff@praella-wms.dev', fullName: 'Rohan Patel', passwordHash } }),
    prisma.user.create({ data: { email: 'staff.mumbai@praella-wms.dev', fullName: 'Meera Nair', passwordHash } }),
  ]);

  const memberships = await Promise.all([
    prisma.membership.create({ data: { userId: admin.id, organizationId: organization.id, role: Role.ADMIN } }),
    prisma.membership.create({ data: { userId: manager.id, organizationId: organization.id, role: Role.MANAGER } }),
    prisma.membership.create({ data: { userId: staffSurat.id, organizationId: organization.id, role: Role.STAFF } }),
    prisma.membership.create({ data: { userId: staffMumbai.id, organizationId: organization.id, role: Role.STAFF } }),
  ]);
  const [, , staffSuratMembership, staffMumbaiMembership] = memberships;

  /* -------------------------------- Warehouses ------------------------------ */

  console.log('› Creating warehouses…');
  const warehouses = [];
  for (const seed of WAREHOUSE_SEEDS) {
    warehouses.push(
      await prisma.warehouse.create({ data: { ...seed, organizationId: organization.id } }),
    );
  }
  const [surat, mumbai, bengaluru] = warehouses;

  // Staff are scoped to a single site each — this is what makes the STAFF
  // warehouse-scoping visible in the demo data.
  await prisma.warehouseMember.createMany({
    data: [
      { membershipId: staffSuratMembership!.id, warehouseId: surat!.id },
      { membershipId: staffMumbaiMembership!.id, warehouseId: mumbai!.id },
    ],
  });

  /* --------------------------- Catalogue & products ------------------------- */

  console.log('› Creating categories, suppliers and products…');
  const categoriesByName = new Map<string, string>();
  for (const seed of CATEGORY_SEEDS) {
    const category = await prisma.category.create({
      data: { ...seed, slug: slugify(seed.name), organizationId: organization.id },
    });
    categoriesByName.set(category.name, category.id);
  }

  const suppliersByName = new Map<string, string>();
  for (const seed of SUPPLIER_SEEDS) {
    const supplier = await prisma.supplier.create({
      data: { ...seed, organizationId: organization.id },
    });
    suppliersByName.set(supplier.name, supplier.id);
  }

  const products: Array<{ id: string; sku: string }> = [];
  for (const seed of PRODUCT_SEEDS) {
    products.push(
      await prisma.product.create({
        data: {
          organizationId: organization.id,
          name: seed.name,
          sku: seed.sku,
          unit: seed.unit,
          unitPrice: seed.unitPrice.toFixed(2),
          categoryId: categoriesByName.get(seed.category)!,
          supplierId: suppliersByName.get(seed.supplier)!,
          defaultReorderPoint: seed.reorderPoint,
          defaultReorderQuantity: seed.reorderQuantity,
          description: `${seed.category} line item supplied by ${seed.supplier}.`,
        },
      }),
    );
  }
  const productsBySku = new Map(products.map((product) => [product.sku, product]));

  /* ------------------------------- Stock ledger ----------------------------- */

  console.log(`› Generating ${DAYS_OF_HISTORY} days of stock movement history…`);
  const ledger = new Ledger(organization.id);
  const recorders = [admin.id, manager.id, staffSurat.id, staffMumbai.id];

  // Opening stock: every product lands in Surat, the fast movers also stock the
  // two downstream sites.
  for (const seed of PRODUCT_SEEDS) {
    const product = productsBySku.get(seed.sku)!;
    const stocked: Array<{ warehouseId: string; multiplier: number }> = [
      { warehouseId: surat!.id, multiplier: 3 },
      { warehouseId: mumbai!.id, multiplier: 2 },
      { warehouseId: bengaluru!.id, multiplier: 1 },
    ];

    for (const { warehouseId, multiplier } of stocked) {
      const opening = Math.round(seed.reorderPoint * multiplier * (0.8 + random() * 0.9));
      if (opening <= 0) continue;
      ledger.apply({
        key: { productId: product.id, warehouseId },
        type: MovementType.INBOUND,
        quantity: opening,
        createdAt: daysAgo(DAYS_OF_HISTORY),
        createdById: admin.id,
        referenceType: MovementReferenceType.MANUAL_ADJUSTMENT,
        note: 'Opening stock migrated from legacy spreadsheet',
        unitCost: (seed.unitPrice * 0.62).toFixed(2),
      });
    }
  }

  // Daily churn: outbound picks with occasional restocks.
  for (let day = DAYS_OF_HISTORY - 1; day >= 0; day -= 1) {
    const movementsToday = randomInt(6, 14);
    for (let i = 0; i < movementsToday; i += 1) {
      const seed = pick(PRODUCT_SEEDS);
      const product = productsBySku.get(seed.sku)!;
      const warehouse = pick([surat!, mumbai!, bengaluru!]);
      const key = { productId: product.id, warehouseId: warehouse.id };
      const balance = ledger.balanceOf(key);
      if (balance <= 0) continue;

      // Occasional cycle-count correction, so the demo data exercises every
      // movement type a reviewer can filter by — not just in/out.
      if (random() < 0.06) {
        const shrinkage = Math.max(1, Math.round(balance * 0.02));
        ledger.apply({
          key,
          type: MovementType.ADJUSTMENT,
          quantity: shrinkage,
          createdAt: daysAgo(day),
          createdById: pick([admin.id, manager.id]),
          referenceType: MovementReferenceType.MANUAL_ADJUSTMENT,
          note: pick([
            'Cycle count variance',
            'Damaged in handling',
            'Write-off after quality check',
          ]),
        });
        continue;
      }

      const outbound = random() < 0.72;
      if (outbound) {
        const quantity = Math.max(1, Math.min(balance, Math.round(seed.reorderPoint * (0.05 + random() * 0.35))));
        if (quantity <= 0) continue;
        ledger.apply({
          key,
          type: MovementType.OUTBOUND,
          quantity,
          createdAt: daysAgo(day),
          createdById: pick(recorders),
          referenceType: MovementReferenceType.MANUAL_ADJUSTMENT,
          note: 'Counter dispatch recorded on the floor',
        });
      } else {
        const quantity = Math.max(1, Math.round(seed.reorderQuantity * (0.15 + random() * 0.35)));
        ledger.apply({
          key,
          type: MovementType.INBOUND,
          quantity,
          createdAt: daysAgo(day),
          createdById: pick(recorders),
          referenceType: MovementReferenceType.MANUAL_ADJUSTMENT,
          note: 'Supplier top-up delivery',
          unitCost: (seed.unitPrice * 0.62).toFixed(2),
        });
      }
    }
  }

  /* ------------------------------ Stock transfer ---------------------------- */

  console.log('› Creating a completed Surat → Bengaluru transfer…');
  const transferSeeds = PRODUCT_SEEDS.slice(0, 3);
  const transferCompletedAt = daysAgo(4);
  const transfer = await prisma.stockTransfer.create({
    data: {
      organizationId: organization.id,
      code: 'TRF-000001',
      status: StockTransferStatus.COMPLETED,
      sourceWarehouseId: surat!.id,
      destinationWarehouseId: bengaluru!.id,
      notes: 'Weekly southern-region replenishment run.',
      createdById: manager.id,
      createdAt: transferCompletedAt,
      completedAt: transferCompletedAt,
      items: {
        create: transferSeeds.map((seed) => ({
          productId: productsBySku.get(seed.sku)!.id,
          quantity: Math.max(1, Math.round(seed.reorderQuantity * 0.15)),
        })),
      },
    },
    include: { items: true },
  });

  for (const item of transfer.items) {
    const sourceKey = { productId: item.productId, warehouseId: surat!.id };
    const available = ledger.balanceOf(sourceKey);
    const quantity = Math.min(item.quantity, available);
    if (quantity <= 0) continue;

    ledger.apply({
      key: sourceKey,
      type: MovementType.TRANSFER_OUT,
      quantity,
      createdAt: transferCompletedAt,
      createdById: manager.id,
      referenceType: MovementReferenceType.STOCK_TRANSFER,
      referenceId: transfer.id,
      referenceCode: transfer.code,
      counterpartWarehouseId: bengaluru!.id,
      note: 'Transfer dispatched',
    });
    ledger.apply({
      key: { productId: item.productId, warehouseId: bengaluru!.id },
      type: MovementType.TRANSFER_IN,
      quantity,
      createdAt: transferCompletedAt,
      createdById: manager.id,
      referenceType: MovementReferenceType.STOCK_TRANSFER,
      referenceId: transfer.id,
      referenceCode: transfer.code,
      counterpartWarehouseId: surat!.id,
      note: 'Transfer received',
    });
  }

  /* ------------------------------- Purchase orders -------------------------- */

  console.log('› Creating purchase orders…');
  const poDefinitions: Array<{
    code: string;
    status: PurchaseOrderStatus;
    supplier: string;
    warehouseId: string;
    skus: string[];
    receivedRatio: number;
    createdDaysAgo: number;
  }> = [
    { code: 'PO-000001', status: PurchaseOrderStatus.RECEIVED, supplier: 'Shenzhen Vertex Electronics', warehouseId: surat!.id, skus: ['ELEC-MON-27', 'ELEC-KBD-01', 'ELEC-MOU-02'], receivedRatio: 1, createdDaysAgo: 12 },
    { code: 'PO-000002', status: PurchaseOrderStatus.PARTIALLY_RECEIVED, supplier: 'Vapi Packaging Solutions', warehouseId: mumbai!.id, skus: ['PKG-BOX-1296', 'PKG-TAP-48', 'PKG-BUB-100'], receivedRatio: 0.5, createdDaysAgo: 6 },
    { code: 'PO-000003', status: PurchaseOrderStatus.SUBMITTED, supplier: 'Tirupur Knitwear Mills', warehouseId: surat!.id, skus: ['APP-TEE-CRW', 'APP-SOC-MER', 'APP-JKT-RAI'], receivedRatio: 0, createdDaysAgo: 2 },
    { code: 'PO-000004', status: PurchaseOrderStatus.DRAFT, supplier: 'Khurja Ceramics House', warehouseId: bengaluru!.id, skus: ['HOME-MUG-ST', 'HOME-JAR-1L'], receivedRatio: 0, createdDaysAgo: 1 },
  ];

  let poCounter = 0;
  for (const definition of poDefinitions) {
    poCounter += 1;
    const createdAt = daysAgo(definition.createdDaysAgo);
    const lines = definition.skus.map((sku) => {
      const seed = PRODUCT_SEEDS.find((candidate) => candidate.sku === sku)!;
      const quantity = seed.reorderQuantity;
      const unitCost = Number((seed.unitPrice * 0.62).toFixed(2));
      return {
        productId: productsBySku.get(sku)!.id,
        quantity,
        receivedQuantity: Math.floor(quantity * definition.receivedRatio),
        unitCost: unitCost.toFixed(2),
        rawUnitCost: unitCost,
      };
    });

    const totalAmount = lines.reduce((sum, line) => sum + line.quantity * line.rawUnitCost, 0);

    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        organizationId: organization.id,
        code: definition.code,
        status: definition.status,
        supplierId: suppliersByName.get(definition.supplier)!,
        warehouseId: definition.warehouseId,
        expectedAt: daysAgo(definition.createdDaysAgo - 10),
        receivedAt: definition.receivedRatio >= 1 ? daysAgo(definition.createdDaysAgo - 5) : null,
        notes: `Replenishment order raised against ${definition.supplier}.`,
        totalAmount: totalAmount.toFixed(2),
        createdById: manager.id,
        createdAt,
        items: {
          create: lines.map(({ rawUnitCost: _rawUnitCost, ...line }) => line),
        },
      },
      include: { items: true },
    });

    // Received quantities must exist in the ledger, otherwise stock levels and
    // order history would disagree.
    for (const item of purchaseOrder.items) {
      if (item.receivedQuantity <= 0) continue;
      ledger.apply({
        key: { productId: item.productId, warehouseId: definition.warehouseId },
        type: MovementType.INBOUND,
        quantity: item.receivedQuantity,
        createdAt: daysAgo(Math.max(0, definition.createdDaysAgo - 5)),
        createdById: manager.id,
        referenceType: MovementReferenceType.PURCHASE_ORDER,
        referenceId: purchaseOrder.id,
        referenceCode: purchaseOrder.code,
        unitCost: item.unitCost.toString(),
        note: 'Goods received against purchase order',
      });
    }
  }

  /* -------------------------------- Sales orders ---------------------------- */

  console.log('› Creating sales orders…');
  const soDefinitions: Array<{
    code: string;
    status: SalesOrderStatus;
    warehouseId: string;
    customerName: string;
    customerEmail: string;
    skus: string[];
    fulfilledRatio: number;
    createdDaysAgo: number;
  }> = [
    { code: 'SO-000001', status: SalesOrderStatus.FULFILLED, warehouseId: mumbai!.id, customerName: 'Aster Retail Pvt Ltd', customerEmail: 'purchase@asterretail.example', skus: ['ELEC-KBD-01', 'ELEC-MOU-02'], fulfilledRatio: 1, createdDaysAgo: 9 },
    { code: 'SO-000002', status: SalesOrderStatus.PARTIALLY_FULFILLED, warehouseId: surat!.id, customerName: 'Vistara Lifestyle', customerEmail: 'orders@vistaralifestyle.example', skus: ['APP-TEE-CRW', 'APP-SHT-OXF'], fulfilledRatio: 0.5, createdDaysAgo: 5 },
    { code: 'SO-000003', status: SalesOrderStatus.ALLOCATED, warehouseId: mumbai!.id, customerName: 'Nova Home Studio', customerEmail: 'buying@novahome.example', skus: ['HOME-SKL-10', 'HOME-KNF-08'], fulfilledRatio: 0, createdDaysAgo: 3 },
    { code: 'SO-000004', status: SalesOrderStatus.DRAFT, warehouseId: bengaluru!.id, customerName: 'Coastal Traders', customerEmail: 'hello@coastaltraders.example', skus: ['PKG-BOX-1296', 'PKG-LBL-46'], fulfilledRatio: 0, createdDaysAgo: 0 },
  ];

  /** Reservations created by ALLOCATED / partially fulfilled orders. */
  const reservations = new Map<string, number>();

  for (const definition of soDefinitions) {
    const createdAt = daysAgo(definition.createdDaysAgo);
    const lines = definition.skus.map((sku) => {
      const seed = PRODUCT_SEEDS.find((candidate) => candidate.sku === sku)!;
      const quantity = Math.max(1, Math.round(seed.reorderPoint * 0.3));
      return {
        productId: productsBySku.get(sku)!.id,
        quantity,
        fulfilledQuantity: Math.floor(quantity * definition.fulfilledRatio),
        unitPrice: seed.unitPrice.toFixed(2),
        rawUnitPrice: seed.unitPrice,
      };
    });

    const totalAmount = lines.reduce((sum, line) => sum + line.quantity * line.rawUnitPrice, 0);

    const salesOrder = await prisma.salesOrder.create({
      data: {
        organizationId: organization.id,
        code: definition.code,
        status: definition.status,
        warehouseId: definition.warehouseId,
        customerName: definition.customerName,
        customerEmail: definition.customerEmail,
        notes: 'Created from the ecommerce integration.',
        totalAmount: totalAmount.toFixed(2),
        fulfilledAt: definition.fulfilledRatio >= 1 ? daysAgo(Math.max(0, definition.createdDaysAgo - 2)) : null,
        createdById: manager.id,
        createdAt,
        items: {
          create: lines.map(({ rawUnitPrice: _rawUnitPrice, ...line }) => line),
        },
      },
      include: { items: true },
    });

    for (const item of salesOrder.items) {
      const key = { productId: item.productId, warehouseId: definition.warehouseId };

      if (item.fulfilledQuantity > 0) {
        const quantity = Math.min(item.fulfilledQuantity, ledger.balanceOf(key));
        if (quantity > 0) {
          ledger.apply({
            key,
            type: MovementType.OUTBOUND,
            quantity,
            createdAt: daysAgo(Math.max(0, definition.createdDaysAgo - 2)),
            createdById: manager.id,
            referenceType: MovementReferenceType.SALES_ORDER,
            referenceId: salesOrder.id,
            referenceCode: salesOrder.code,
            note: 'Dispatched against sales order',
          });
        }
      }

      // Outstanding quantity on a live order stays reserved against the site.
      const outstanding = item.quantity - item.fulfilledQuantity;
      if (
        outstanding > 0 &&
        (definition.status === SalesOrderStatus.ALLOCATED ||
          definition.status === SalesOrderStatus.PARTIALLY_FULFILLED)
      ) {
        const composite = `${item.productId}::${definition.warehouseId}`;
        reservations.set(composite, (reservations.get(composite) ?? 0) + outstanding);
      }
    }
  }

  /* ---------------------- Materialise ledger → stock levels ------------------ */

  console.log(`› Writing ${ledger.movements.length} stock movements…`);
  // Sorted so `balanceAfter` reads monotonically when the history is viewed by
  // creation time.
  const orderedMovements = [...ledger.movements].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  await prisma.stockMovement.createMany({ data: orderedMovements });

  console.log('› Materialising stock levels from the ledger…');
  const reorderBySku = new Map(PRODUCT_SEEDS.map((seed) => [seed.sku, seed]));
  const stockLevelRows = ledger.entries().map(({ key, quantity }) => {
    const product = products.find((candidate) => candidate.id === key.productId)!;
    const seed = reorderBySku.get(product.sku)!;
    const composite = `${key.productId}::${key.warehouseId}`;
    return {
      organizationId: organization.id,
      productId: key.productId,
      warehouseId: key.warehouseId,
      quantity,
      reservedQuantity: Math.min(reservations.get(composite) ?? 0, Math.max(quantity, 0)),
      reorderPoint: seed.reorderPoint,
      reorderQuantity: seed.reorderQuantity,
    };
  });
  await prisma.stockLevel.createMany({ data: stockLevelRows });

  /* ------------------------------ Document counters -------------------------- */

  await prisma.documentCounter.createMany({
    data: [
      { organizationId: organization.id, scope: 'PO', value: poCounter },
      { organizationId: organization.id, scope: 'SO', value: soDefinitions.length },
      { organizationId: organization.id, scope: 'TRF', value: 1 },
    ],
  });

  /* --------------------------------- Audit log ------------------------------- */

  await prisma.auditLog.createMany({
    data: [
      { organizationId: organization.id, actorId: admin.id, action: 'organization.created', entityType: 'Organization', entityId: organization.id, metadata: { source: 'seed' }, createdAt: daysAgo(DAYS_OF_HISTORY) },
      { organizationId: organization.id, actorId: admin.id, action: 'member.invited', entityType: 'Membership', entityId: staffSuratMembership!.id, metadata: { role: 'STAFF' }, createdAt: daysAgo(DAYS_OF_HISTORY - 1) },
      { organizationId: organization.id, actorId: manager.id, action: 'stock_transfer.completed', entityType: 'StockTransfer', entityId: transfer.id, metadata: { code: transfer.code }, createdAt: transferCompletedAt },
    ],
  });

  /* ------------------- Second tenant, to prove data isolation ---------------- */

  console.log('› Creating a second organisation to demonstrate tenant isolation…');
  const otherOrganization = await prisma.organization.create({
    data: { name: 'Northwind Traders', slug: 'northwind-traders' },
  });
  const otherAdmin = await prisma.user.create({
    data: { email: 'admin@northwind-wms.dev', fullName: 'Priya Raghavan', passwordHash },
  });
  await prisma.membership.create({
    data: { userId: otherAdmin.id, organizationId: otherOrganization.id, role: Role.ADMIN },
  });
  const otherWarehouse = await prisma.warehouse.create({
    data: {
      organizationId: otherOrganization.id,
      name: 'Pune Depot',
      code: 'PNQ-DEP',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
    },
  });
  const otherCategory = await prisma.category.create({
    data: { organizationId: otherOrganization.id, name: 'Beverages', slug: 'beverages' },
  });
  const otherProduct = await prisma.product.create({
    data: {
      organizationId: otherOrganization.id,
      name: 'Northwind Cold Brew 250ml',
      sku: 'NW-CB-250',
      unitPrice: '149.00',
      categoryId: otherCategory.id,
      defaultReorderPoint: 100,
      defaultReorderQuantity: 400,
    },
  });
  await prisma.stockLevel.create({
    data: {
      organizationId: otherOrganization.id,
      productId: otherProduct.id,
      warehouseId: otherWarehouse.id,
      quantity: 320,
      reorderPoint: 100,
      reorderQuantity: 400,
    },
  });

  /* ---------------------------------- Summary -------------------------------- */

  const belowThreshold = stockLevelRows.filter((row) => row.quantity <= row.reorderPoint).length;

  console.log('\n✔ Seed complete\n');
  console.table({
    organizations: 2,
    users: 5,
    warehouses: WAREHOUSE_SEEDS.length + 1,
    categories: CATEGORY_SEEDS.length + 1,
    suppliers: SUPPLIER_SEEDS.length,
    products: PRODUCT_SEEDS.length + 1,
    stockLevels: stockLevelRows.length + 1,
    stockMovements: orderedMovements.length,
    purchaseOrders: poDefinitions.length,
    salesOrders: soDefinitions.length,
    stockTransfers: 1,
    linesBelowThreshold: belowThreshold,
  });

  console.log('Demo credentials (password for all accounts: %s):', SEED_PASSWORD);
  console.table([
    { role: 'ADMIN', email: 'admin@praella-wms.dev', scope: 'All warehouses' },
    { role: 'MANAGER', email: 'manager@praella-wms.dev', scope: 'All warehouses' },
    { role: 'STAFF', email: 'staff@praella-wms.dev', scope: 'Surat Central Hub only' },
    { role: 'STAFF', email: 'staff.mumbai@praella-wms.dev', scope: 'Mumbai DC only' },
    { role: 'ADMIN', email: 'admin@northwind-wms.dev', scope: 'Separate organisation' },
  ]);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
