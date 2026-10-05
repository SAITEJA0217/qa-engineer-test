process.env.NODE_ENV = 'test';
import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../server.js';

describe('Payment Routes - /api/payments', () => {
  let merchantToken;
  let otherMerchantToken;

  before(async () => {
    // Register primary test merchant
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `pay_merchant_${Date.now()}@eupay.com`,
        password: 'Password123!',
        business_name: 'Payment Test Merchant'
      });
    merchantToken = regRes.body.token;

    // Register second merchant for isolation/access control tests
    const otherRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `other_merchant_${Date.now()}@eupay.com`,
        password: 'Password123!',
        business_name: 'Other Test Merchant'
      });
    otherMerchantToken = otherRes.body.token;
  });

  it('PAY-01: GET /api/payments returns payment amounts as numbers (Bug A Regression)', async () => {
    // First create a payment to ensure at least one exists for this merchant
    await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 25.5,
        currency: 'EUR',
        customer_email: 'buyer@example.com'
      });

    const response = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.ok(Array.isArray(response.body.data));
    assert.ok(response.body.data.length > 0);
    assert.strictEqual(typeof response.body.data[0].amount, 'number');
    assert.strictEqual(response.body.data[0].amount, 25.5);
  });

  it('PAY-02: GET /api/payments/:id returns numeric amount (Bug A Regression)', async () => {
    const createRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 89.99,
        currency: 'EUR',
        customer_email: 'buyer2@example.com'
      });
    const paymentId = createRes.body.data.id;

    const response = await request(app)
      .get(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${merchantToken}`);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(typeof response.body.data.amount, 'number');
    assert.strictEqual(response.body.data.amount, 89.99);
  });

  it('PAY-03: Valid payment amount succeeds with 201 Created', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 100,
        currency: 'EUR',
        customer_email: 'customer100@test.com'
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.amount, 100);
    assert.strictEqual(typeof response.body.data.amount, 'number');
    assert.strictEqual(response.body.data.currency, 'EUR');
    assert.strictEqual(response.body.data.status, 'pending');
  });

  it('PAY-04: Amount above €50,000 is rejected with 400 (Bug B Regression)', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 999999,
        currency: 'EUR',
        customer_email: 'wealthy_client@test.com'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Amount exceeds maximum limit of €50,000');
  });

  it('PAY-04b: Amount €50,000.01 is rejected with 400 (Bug B Boundary Test)', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 50000.01,
        currency: 'EUR',
        customer_email: 'boundary_test@test.com'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Amount exceeds maximum limit of €50,000');
  });

  it('PAY-05: Amount exactly €50,000 is accepted with 201 (Bug B Boundary Test)', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 50000,
        currency: 'EUR',
        customer_email: 'max_allowed@test.com'
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.amount, 50000);
  });

  it('PAY-06: Zero amount is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 0,
        currency: 'EUR',
        customer_email: 'zero_pay@test.com'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Valid amount is required');
  });

  it('PAY-06b: Negative amount is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: -50,
        currency: 'EUR',
        customer_email: 'negative_pay@test.com'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Valid amount is required');
  });

  it('PAY-07: Payment creation without authentication is rejected with 401', async () => {
    const response = await request(app)
      .post('/api/payments')
      .send({
        amount: 50,
        currency: 'EUR',
        customer_email: 'noauth@test.com'
      });

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Authentication required');
  });

  it('PAY-08: Invalid currency is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 50,
        currency: 'INVALID_CURRENCY',
        customer_email: 'currency@test.com'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Valid currency is required (EUR, USD, GBP)');
  });

  it('PAY-09: Cross-merchant payment access is denied with 403', async () => {
    const createRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 75,
        currency: 'EUR',
        customer_email: 'merchant1_client@test.com'
      });
    const paymentId = createRes.body.data.id;

    // Try accessing with otherMerchantToken
    const response = await request(app)
      .get(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${otherMerchantToken}`);

    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.error, 'Access denied');
  });

  it('SEC-03: Very large payment amount (€1,000,000,000) is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 1000000000,
        currency: 'EUR',
        customer_email: 'billionaire@test.com'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Amount exceeds maximum limit of €50,000');
  });

  it('SEC-06: Non-existent / large payment_id returns 404 cleanly without crashing', async () => {
    const response = await request(app)
      .get('/api/payments/999999999')
      .set('Authorization', `Bearer ${merchantToken}`);

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'Payment not found');
  });
});
