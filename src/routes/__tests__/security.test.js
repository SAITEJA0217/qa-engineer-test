process.env.NODE_ENV = 'test';
import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../server.js';

const WEBHOOK_SECRET = 'test-webhook-secret-key';

function generateSignature(payload, secret = WEBHOOK_SECRET) {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

describe('Security & Edge Case Tests', () => {
  let merchantToken;
  let merchantId;

  before(async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `sec_merchant_${Date.now()}@eupay.com`,
        password: 'Password123!',
        business_name: 'Security Test Cafe'
      });
    merchantToken = regRes.body.token;
    merchantId = regRes.body.user.id;
  });

  it('SEC-01: SQL injection payload in login does not bypass authentication', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: "admin' OR '1'='1",
        password: "password' OR '1'='1"
      });

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid credentials');
  });

  it('SEC-02: XSS script payload in customer_name or business_name is treated as literal data without server failure', async () => {
    const response = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId,
        table_number: 999,
        customer_name: '<script>alert("XSS")</script>',
        items: [{ name: '<img src=x onerror=alert(1)>', price: 10.0, quantity: 1 }]
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.data.customer_name, '<script>alert("XSS")</script>');
    assert.strictEqual(response.body.data.items[0].name, '<img src=x onerror=alert(1)>');
  });

  it('SEC-03: Exceptionally large payment amount (€1,000,000,000) is rejected by limit validation (Bug B)', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 1000000000,
        currency: 'EUR',
        customer_email: 'ultra_whale@test.com'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Amount exceeds maximum limit of €50,000');
  });

  it('SEC-04: Unicode characters and emojis in names/descriptions are handled safely', async () => {
    const response = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId,
        table_number: 998,
        customer_name: 'Café des Étoiles 🌟 お客様 Дмитрий',
        items: [{ name: 'Croissant au beurre 🥐', price: 5.5, quantity: 2 }]
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.data.customer_name, 'Café des Étoiles 🌟 お客様 Дмитрий');
    assert.strictEqual(response.body.data.total, 11.0);
  });

  it('SEC-05: Webhook with null or empty event_id is rejected with 400', async () => {
    const payload = {
      payment_id: '1',
      status: 'completed',
      event_id: null
    };
    const signature = generateSignature(payload);

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', signature)
      .send(payload);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'payment_id, status, and event_id required');
  });

  it('SEC-06: Extremely large/malformed payment ID does not crash the server', async () => {
    const largeId = '9'.repeat(100);
    const response = await request(app)
      .get(`/api/payments/${largeId}`)
      .set('Authorization', `Bearer ${merchantToken}`);

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'Payment not found');
  });
});
