import type { INestApplication } from '@nestjs/common';
import {
  api,
  createTestApp,
  resetDatabase,
  TEST_PASSWORD,
} from './setup/test-app';

describe('Authentication (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const signUpPayload = {
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    password: TEST_PASSWORD,
    organizationName: 'Analytical Engines',
  };

  describe('sign-up', () => {
    it('creates the user, their organisation and an ADMIN membership', async () => {
      const response = await api(app)
        .post('/api/v1/auth/sign-up')
        .send(signUpPayload)
        .expect(201);

      expect(response.body.user.email).toBe('ada@example.com');
      expect(response.body.user.memberships).toHaveLength(1);
      expect(response.body.user.memberships[0]).toMatchObject({
        organizationName: 'Analytical Engines',
        role: 'ADMIN',
      });
      expect(response.body.tokens.tokenType).toBe('Bearer');
      expect(response.body.tokens.accessToken).toEqual(expect.any(String));
    });

    it('never returns the password hash', async () => {
      const response = await api(app)
        .post('/api/v1/auth/sign-up')
        .send(signUpPayload)
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain(TEST_PASSWORD);
    });

    it('rejects a weak password with field-level detail', async () => {
      const response = await api(app)
        .post('/api/v1/auth/sign-up')
        .send({ ...signUpPayload, password: 'short' })
        .expect(422);

      expect(response.body.error).toBe('Validation Failed');
      expect(
        response.body.details.map((d: { path: string }) => d.path),
      ).toContain('password');
    });

    it('rejects a duplicate email with 409', async () => {
      await api(app)
        .post('/api/v1/auth/sign-up')
        .send(signUpPayload)
        .expect(201);

      await api(app)
        .post('/api/v1/auth/sign-up')
        .send({ ...signUpPayload, organizationName: 'Another Org' })
        .expect(409);
    });

    it('gives each organisation a unique slug even for identical names', async () => {
      await api(app)
        .post('/api/v1/auth/sign-up')
        .send(signUpPayload)
        .expect(201);

      const second = await api(app)
        .post('/api/v1/auth/sign-up')
        .send({ ...signUpPayload, email: 'grace@example.com' })
        .expect(201);

      expect(second.body.user.memberships[0].organizationSlug).toBe(
        'analytical-engines-2',
      );
    });
  });

  describe('sign-in', () => {
    beforeEach(async () => {
      await api(app)
        .post('/api/v1/auth/sign-up')
        .send(signUpPayload)
        .expect(201);
    });

    it('issues tokens for correct credentials', async () => {
      const response = await api(app)
        .post('/api/v1/auth/sign-in')
        .send({ email: 'ada@example.com', password: TEST_PASSWORD })
        .expect(200);

      expect(response.body.tokens.accessToken).toEqual(expect.any(String));
    });

    it('returns the same error for a wrong password and an unknown account', async () => {
      const wrongPassword = await api(app)
        .post('/api/v1/auth/sign-in')
        .send({ email: 'ada@example.com', password: 'WrongPassw0rd!' })
        .expect(401);

      const unknownUser = await api(app)
        .post('/api/v1/auth/sign-in')
        .send({ email: 'nobody@example.com', password: TEST_PASSWORD })
        .expect(401);

      // Identical messages: anything else makes sign-in an account-enumeration oracle.
      expect(wrongPassword.body.message).toBe(unknownUser.body.message);
    });
  });

  describe('tokens', () => {
    let refreshToken: string;
    let accessToken: string;

    beforeEach(async () => {
      const response = await api(app)
        .post('/api/v1/auth/sign-up')
        .send(signUpPayload)
        .expect(201);
      refreshToken = response.body.tokens.refreshToken;
      accessToken = response.body.tokens.accessToken;
    });

    it('rotates the refresh token and returns a new pair', async () => {
      const response = await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.refreshToken).not.toBe(refreshToken);
      expect(response.body.accessToken).toEqual(expect.any(String));
    });

    it('revokes every session when a rotated token is replayed', async () => {
      const rotated = await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      // Replaying the original token is the signature of a stolen credential.
      await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      // …and the legitimate client's newer token is revoked too, as a precaution.
      await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
    });

    it('rejects a refresh token presented as an access token', async () => {
      await api(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(401);
    });

    it('rejects a request with no token at all', async () => {
      await api(app).get('/api/v1/auth/me').expect(401);
    });

    it('returns the resolved permission list for the active organisation', async () => {
      const response = await api(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.activeRole).toBe('ADMIN');
      expect(response.body.permissions).toContain('warehouse:delete');
      expect(response.body.warehouseScope).toBeNull();
    });

    it('invalidates a refresh token after sign-out', async () => {
      await api(app)
        .post('/api/v1/auth/sign-out')
        .send({ refreshToken })
        .expect(204);
      await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  it('reports a consistent error body shape on every failure', async () => {
    const response = await api(app).get('/api/v1/warehouses').expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      error: expect.any(String),
      message: expect.any(String),
      path: '/api/v1/warehouses',
      timestamp: expect.any(String),
      requestId: expect.any(String),
    });
  });
});
