process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../server.js';

describe('Authentication Routes - /api/auth', () => {
  it('AUTH-01: Valid registration succeeds with 201 and returns token', async () => {
    const uniqueEmail = `valid_user_${Date.now()}@eupay.com`;
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail,
        password: 'Password123!',
        business_name: 'Valid Coffee Shop'
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.message, 'Registration successful');
    assert.strictEqual(response.body.user.email, uniqueEmail);
    assert.strictEqual(response.body.user.business_name, 'Valid Coffee Shop');
    assert.ok(response.body.token, 'Token must be present in registration response');
    assert.strictEqual(typeof response.body.token, 'string');
  });

  it('AUTH-02: Invalid email without a valid domain extension is rejected with 400 (Bug C Regression)', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'baduser@domain',
        password: 'Password123!',
        business_name: 'No TLD Cafe'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Invalid email format');
  });

  it('AUTH-02b: Invalid email without @ symbol is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'plainaddress.com',
        password: 'Password123!',
        business_name: 'Malformed Email Cafe'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Invalid email format');
  });

  it('AUTH-03: Valid login succeeds after registration with 200 and returns token', async () => {
    const email = `login_user_${Date.now()}@test.com`;
    const password = 'SecurePassword123!';

    // Register user
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password,
        business_name: 'Login Test Merchant'
      });
    assert.strictEqual(regRes.status, 201);

    // Login with registered credentials
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email,
        password
      });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.body.message, 'Login successful');
    assert.strictEqual(loginRes.body.user.email, email);
    assert.ok(loginRes.body.token, 'Token should be returned on successful login');
  });

  it('AUTH-04: Invalid credentials (wrong password) are rejected with 401', async () => {
    const email = `wrong_pw_${Date.now()}@test.com`;
    await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'CorrectPassword123!',
        business_name: 'Wrong PW Shop'
      });

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email,
        password: 'WrongPassword123!'
      });

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid credentials');
  });

  it('AUTH-05: Duplicate email registration is rejected with 409 Conflict', async () => {
    const email = `dup_user_${Date.now()}@test.com`;
    const userPayload = {
      email,
      password: 'Password123!',
      business_name: 'First Store'
    };

    const first = await request(app).post('/api/auth/register').send(userPayload);
    assert.strictEqual(first.status, 201);

    const duplicate = await request(app).post('/api/auth/register').send({
      ...userPayload,
      business_name: 'Second Store'
    });
    assert.strictEqual(duplicate.status, 409);
    assert.strictEqual(duplicate.body.error, 'Email already registered');
  });

  it('AUTH-06: Registration with short password (<8 characters) is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: `short_pw_${Date.now()}@test.com`,
        password: 'short',
        business_name: 'Short PW Cafe'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Password must be at least 8 characters');
  });

  it('AUTH-07: Registration with missing or short business name is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: `nobiz_${Date.now()}@test.com`,
        password: 'Password123!',
        business_name: ' '
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Business name is required');
  });

  it('AUTH-08: Login with non-existent email is rejected with 401', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: `nonexistent_${Date.now()}@test.com`,
        password: 'Password123!'
      });

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid credentials');
  });

  it('AUTH-09: Login with missing email or password is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@test.com'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Email and password required');
  });

  it('SEC-01: SQL injection-style payload in auth does not bypass authentication', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: "' OR '1'='1",
        password: "' OR '1'='1"
      });

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid credentials');
  });
});
