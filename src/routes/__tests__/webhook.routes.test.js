process.env.NODE_ENV = 'test';
import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { db } from '../../db/database.js';

const WEBHOOK_SECRET = 'test-webhook-secret-key';

function generateSignature(payload, secret = WEBHOOK_SECRET) {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

describe('Webhook Routes - /api/webhooks', () => {
  let merchantToken;
  let testPaymentId;

  before(async () => {
    // Setup test merchant and payment
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `webhook_merchant_${Date.now()}@eupay.com`,
        password: 'Password123!',
        business_name: 'Webhook Test Merchant'
      });
    merchantToken = regRes.body.token;

    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 45.0,
        currency: 'EUR',
        customer_email: 'webhook_test@example.com'
      });
    testPaymentId = payRes.body.data.id;
  });

  it('WEB-01: Webhook without signature header is rejected with 401 (Bug D Regression)', async () => {
    const payload = {
      payment_id: testPaymentId,
      status: 'completed',
      event_id: `evt_no_sig_${Date.now()}`
    };

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .send(payload);

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Signature required');
  });

  it('WEB-02: Webhook with invalid signature is rejected with 401 (Bug D Regression)', async () => {
    const payload = {
      payment_id: testPaymentId,
      status: 'completed',
      event_id: `evt_inv_sig_${Date.now()}`
    };

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', 'invalid_signature_hex_value_1234567890abcdef1234567890abcdef')
      .send(payload);

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid signature');
  });

  it('WEB-02b: Webhook signed with wrong secret key is rejected with 401 (Bug D Regression)', async () => {
    const payload = {
      payment_id: testPaymentId,
      status: 'completed',
      event_id: `evt_wrong_secret_${Date.now()}`
    };
    const wrongSignature = generateSignature(payload, 'wrong-secret-key-12345');

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', wrongSignature)
      .send(payload);

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid signature');
  });

  it('WEB-03: Webhook with valid HMAC signature processes successfully with 200 (Bug D Fix Verification)', async () => {
    // Create dedicated payment
    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 60.0,
        currency: 'EUR',
        customer_email: 'web3@test.com'
      });
    const paymentId = payRes.body.data.id;

    const payload = {
      payment_id: paymentId,
      status: 'completed',
      event_id: `evt_valid_${Date.now()}`
    };
    const signature = generateSignature(payload);

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', signature)
      .send(payload);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.new_status, 'completed');
  });

  it('WEB-04: Duplicate event_id is rejected with 409 Conflict (Bug E Regression)', async () => {
    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 75.0,
        currency: 'EUR',
        customer_email: 'web4@test.com'
      });
    const paymentId = payRes.body.data.id;
    const eventId = `evt_dup_${Date.now()}`;

    const payload = {
      payment_id: paymentId,
      status: 'completed',
      event_id: eventId
    };
    const signature = generateSignature(payload);

    // First submission
    const firstRes = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', signature)
      .send(payload);
    assert.strictEqual(firstRes.status, 200);

    // Second submission with exact same event_id
    const secondRes = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', signature)
      .send(payload);
    assert.strictEqual(secondRes.status, 409);
    assert.strictEqual(secondRes.body.error, 'Webhook event already processed');
  });

  it('WEB-05: Same event_id with altered status is rejected and original status remains unchanged (Bug E Regression)', async () => {
    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 80.0,
        currency: 'EUR',
        customer_email: 'web5@test.com'
      });
    const paymentId = payRes.body.data.id;
    const eventId = `evt_tamper_${Date.now()}`;

    const firstPayload = {
      payment_id: paymentId,
      status: 'completed',
      event_id: eventId
    };
    const firstSig = generateSignature(firstPayload);

    const firstRes = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', firstSig)
      .send(firstPayload);
    assert.strictEqual(firstRes.status, 200);

    // Second delivery with status altered to 'failed'
    const secondPayload = {
      payment_id: paymentId,
      status: 'failed',
      event_id: eventId
    };
    const secondSig = generateSignature(secondPayload);

    const secondRes = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', secondSig)
      .send(secondPayload);
    assert.strictEqual(secondRes.status, 409);
    assert.strictEqual(secondRes.body.error, 'Webhook event already processed');

    // Verify payment in database still has status === 'completed'
    const checkPayment = await request(app)
      .get(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${merchantToken}`);
    assert.strictEqual(checkPayment.body.data.status, 'completed');
  });

  it('WEB-06: Webhook with missing event_id is rejected with 400', async () => {
    const payload = {
      payment_id: testPaymentId,
      status: 'completed'
    };
    const signature = generateSignature(payload);

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', signature)
      .send(payload);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'payment_id, status, and event_id required');
  });

  it('WEB-07: Webhook with empty event_id is rejected with 400', async () => {
    const payload = {
      payment_id: testPaymentId,
      status: 'completed',
      event_id: ''
    };
    const signature = generateSignature(payload);

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', signature)
      .send(payload);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'payment_id, status, and event_id required');
  });

  it('WEB-08: Webhook with whitespace-only event_id is rejected with 400', async () => {
    const payload = {
      payment_id: testPaymentId,
      status: 'completed',
      event_id: '   '
    };
    const signature = generateSignature(payload);

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', signature)
      .send(payload);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'payment_id, status, and event_id required');
  });

  it('WEB-09: Webhook with valid signature for non-existent payment returns 404', async () => {
    const payload = {
      payment_id: 'nonexistent_pay_id_99999',
      status: 'completed',
      event_id: `evt_404_${Date.now()}`
    };
    const signature = generateSignature(payload);

    const response = await request(app)
      .post('/api/webhooks/payment-status')
      .set('x-webhook-signature', signature)
      .send(payload);

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'Payment not found');
  });

  it('WEB-10: Concurrent duplicate webhook delivery (5 parallel requests) results in exactly 1 success and 4 conflicts', async () => {
    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        amount: 90.0,
        currency: 'EUR',
        customer_email: 'concurrent@test.com'
      });
    const paymentId = payRes.body.data.id;
    const sharedEventId = `evt_concurrent_${Date.now()}`;

    const payload = {
      payment_id: paymentId,
      status: 'completed',
      event_id: sharedEventId
    };
    const signature = generateSignature(payload);

    const promises = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/webhooks/payment-status')
        .set('x-webhook-signature', signature)
        .send(payload)
    );

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.status === 200).length;
    const conflictCount = results.filter(r => r.status === 409).length;

    assert.strictEqual(successCount, 1, 'Exactly one concurrent request must succeed with 200');
    assert.strictEqual(conflictCount, 4, 'All four duplicate concurrent requests must be rejected with 409');
  });

  it('WEB-11: POST /api/webhooks/e-invoice updates invoice status cleanly', async () => {
    // Create an invoice first
    const invId = `INV-WH-${Date.now()}`;
    db.invoices.push({
      id: invId,
      merchant_id: '1',
      invoice_number: `INV-${Date.now()}`,
      amount: 120.0,
      currency: 'EUR',
      customer_siret: '12345678901234',
      status: 'draft',
      created_at: new Date()
    });

    const response = await request(app)
      .post('/api/webhooks/e-invoice')
      .send({
        invoice_id: invId,
        status: 'accepted',
        submission_id: 'SUB-WH-12345',
        tax_authority_id: 'FR-TAX-998877'
      });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.status, 'accepted');
  });
});
