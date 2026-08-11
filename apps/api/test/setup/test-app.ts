import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/** A signed-in test actor. */
export interface TestActor {
  token: string;
  userId: string;
  email: string;
}

/** The fixture organisation created by `seedFixture`. */
export interface Fixture {
  organizationId: string;
  admin: TestActor;
  manager: TestActor;
  /** Staff member scoped to `warehouseA` only. */
  staff: TestActor;
  /** Admin of a *different* organisation, for isolation assertions. */
  outsider: TestActor;
  outsiderOrganizationId: string;
  warehouseA: string;
  warehouseB: string;
  supplierId: string;
  categoryId: string;
  productId: string;
  productSku: string;
}

export const TEST_PASSWORD = 'TestPassw0rd!';

/**
 * Boots the real application for integration testing.
 *
 * Rate limiting is disabled by default. The auth routes carry a deliberately
 * tight per-route limit (10 requests/minute) which a spec making dozens of
 * sign-ins would trip immediately — so it is switched off here and verified by
 * one dedicated spec that opts back in via `{ throttle: true }`.
 *
 * @param options - Set `throttle: true` to keep the real rate limiter active.
 * @returns The initialised Nest application.
 */
export async function createTestApp(
  options: { throttle?: boolean } = {},
): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });

  if (!options.throttle) {
    builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true });
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/ready', 'metrics'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();
  return app;
}

/** Convenience wrapper returning a Supertest agent bound to the API prefix. */
export function api(app: INestApplication) {
  return request(app.getHttpServer());
}

/** Removes every row so each spec starts from a known state. */
export async function resetDatabase(app: INestApplication): Promise<void> {
  await app.get(PrismaService).truncateAllTables();
}

/**
 * Registers a user (creating their organisation) and returns a signed-in actor.
 */
async function signUp(
  app: INestApplication,
  email: string,
  organizationName: string,
): Promise<{ actor: TestActor; organizationId: string }> {
  const response = await api(app)
    .post('/api/v1/auth/sign-up')
    .send({
      fullName: email.split('@')[0],
      email,
      password: TEST_PASSWORD,
      organizationName,
    })
    .expect(201);

  return {
    actor: {
      token: response.body.tokens.accessToken,
      userId: response.body.user.id,
      email,
    },
    organizationId: response.body.user.memberships[0].organizationId,
  };
}

/** Signs an existing user in. */
export async function signIn(
  app: INestApplication,
  email: string,
): Promise<TestActor> {
  const response = await api(app)
    .post('/api/v1/auth/sign-in')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);

  return {
    token: response.body.tokens.accessToken,
    userId: response.body.user.id,
    email,
  };
}

/**
 * Builds a complete, minimal fixture: two organisations, three roles, two
 * warehouses, and one product with stock. Every spec starts from this.
 *
 * @param app - The initialised test application.
 * @returns Identifiers and actors for use in assertions.
 */
export async function seedFixture(app: INestApplication): Promise<Fixture> {
  await resetDatabase(app);

  const { actor: admin, organizationId } = await signUp(
    app,
    'admin@fixture.test',
    'Fixture Logistics',
  );
  const { actor: outsider, organizationId: outsiderOrganizationId } =
    await signUp(app, 'outsider@other.test', 'Other Company');

  const asAdmin = (path: string) =>
    api(app).post(path).set('Authorization', `Bearer ${admin.token}`);

  const warehouseA = (
    await asAdmin('/api/v1/warehouses')
      .send({ name: 'Alpha Depot', code: 'ALPHA', city: 'Surat' })
      .expect(201)
  ).body.id as string;

  const warehouseB = (
    await asAdmin('/api/v1/warehouses')
      .send({ name: 'Beta Depot', code: 'BETA', city: 'Mumbai' })
      .expect(201)
  ).body.id as string;

  const categoryId = (
    await asAdmin('/api/v1/categories').send({ name: 'Widgets' }).expect(201)
  ).body.id as string;

  const supplierId = (
    await asAdmin('/api/v1/suppliers')
      .send({ name: 'Acme Supplies' })
      .expect(201)
  ).body.id as string;

  const productSku = 'WIDGET-01';
  const productId = (
    await asAdmin('/api/v1/products')
      .send({
        name: 'Standard Widget',
        sku: productSku,
        categoryId,
        supplierId,
        unitPrice: 100.5,
        defaultReorderPoint: 20,
        defaultReorderQuantity: 100,
      })
      .expect(201)
  ).body.id as string;

  // Manager and staff join the same organisation; staff is scoped to Alpha.
  await asAdmin('/api/v1/organization/members')
    .send({
      email: 'manager@fixture.test',
      fullName: 'Fixture Manager',
      role: 'MANAGER',
      temporaryPassword: TEST_PASSWORD,
    })
    .expect(201);

  await asAdmin('/api/v1/organization/members')
    .send({
      email: 'staff@fixture.test',
      fullName: 'Fixture Staff',
      role: 'STAFF',
      temporaryPassword: TEST_PASSWORD,
      warehouseIds: [warehouseA],
    })
    .expect(201);

  const manager = await signIn(app, 'manager@fixture.test');
  const staff = await signIn(app, 'staff@fixture.test');

  // Opening stock at Alpha so outbound flows have something to move.
  await api(app)
    .post('/api/v1/stock/movements')
    .set('Authorization', `Bearer ${manager.token}`)
    .send({
      productId,
      warehouseId: warehouseA,
      type: 'INBOUND',
      quantity: 500,
    })
    .expect(201);

  return {
    organizationId,
    admin,
    manager,
    staff,
    outsider,
    outsiderOrganizationId,
    warehouseA,
    warehouseB,
    supplierId,
    categoryId,
    productId,
    productSku,
  };
}
