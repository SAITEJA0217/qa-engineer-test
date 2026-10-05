process.env.NODE_ENV = 'test';
import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../server.js';

describe('E-Invoice Routes - /api/einvoice', () => {
  let merchantToken;
  let otherMerchantToken;

  before(async () => {
    // Primary merchant
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `inv_merchant_${Date.now()}@eupay.com`,
        password: 'Password123!',
        business_name: 'E-Invoice Test Merchant'
      });
    merchantToken = regRes.body.token;

    // Secondary merchant
    const otherRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `other_inv_merchant_${Date.now()}@eupay.com`,
        password: 'Password123!',
        business_name: 'Other E-Invoice Merchant'
      });
    otherMerchantToken = otherRes.body.token;
  });

  it('INV-01: First valid e-invoice submission succeeds with 200', async () => {
    const invoiceId = `INV_TEST_${Date.now()}_01`;
    const siret = '12345678901234';

    const response = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: siret
      });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.invoice_id, invoiceId);
    assert.strictEqual(response.body.data.status, 'submitted');
    assert.ok(response.body.data.submission_id);
  });

  it('INV-02: Exact duplicate invoice_id is rejected with 409 Conflict (Bug G Regression)', async () => {
    const invoiceId = `INV_DUP_${Date.now()}`;
    const siret = '12345678901234';

    // First submission
    const firstRes = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: siret
      });
    assert.strictEqual(firstRes.status, 200);

    // Exact duplicate submission
    const duplicateRes = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: siret
      });

    assert.strictEqual(duplicateRes.status, 409);
    assert.strictEqual(duplicateRes.body.error, 'Invoice already submitted to tax authority');
  });

  it('INV-03: Same invoice_id with changed SIRET is still rejected with 409 (Bug G Regression)', async () => {
    const invoiceId = `INV_MOD_${Date.now()}`;

    // First submission
    const firstRes = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: '12345678901234'
      });
    assert.strictEqual(firstRes.status, 200);

    // Duplicate submission with altered SIRET
    const duplicateRes = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: '99999999999999'
      });

    assert.strictEqual(duplicateRes.status, 409);
    assert.strictEqual(duplicateRes.body.error, 'Invoice already submitted to tax authority');
  });

  it('INV-04: New distinct invoice_id succeeds with 200', async () => {
    const invoiceId = `INV_NEW_${Date.now()}`;
    const response = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: '98765432109876'
      });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.data.invoice_id, invoiceId);
    assert.strictEqual(response.body.data.status, 'submitted');
  });

  it('INV-05: Invalid 13-digit SIRET is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: `INV_BAD_SIRET_${Date.now()}`,
        customer_siret: '1234567890123' // 13 digits
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Valid customer SIRET required for e-invoicing (14 digits)');
  });

  it('INV-05b: Missing SIRET is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: `INV_NO_SIRET_${Date.now()}`
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Valid customer SIRET required for e-invoicing (14 digits)');
  });

  it('INV-06: Previously invalid invoice_id can be retried with valid SIRET and succeed (Bug G Fix Boundary Test)', async () => {
    const invoiceId = `INV_RETRY_${Date.now()}`;

    // 1. Initial attempt fails due to 12-digit SIRET
    const failedRes = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: '123456789012' // 12 digits
      });
    assert.strictEqual(failedRes.status, 400);

    // 2. Retry with valid 14-digit SIRET succeeds because invoice was not yet submitted
    const successRes = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: '12345678901234'
      });

    assert.strictEqual(successRes.status, 200);
    assert.strictEqual(successRes.body.data.invoice_id, invoiceId);
    assert.strictEqual(successRes.body.data.status, 'submitted');
  });

  it('INV-07: Missing invoice_id is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        customer_siret: '12345678901234'
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'invoice_id required');
  });

  it('INV-08: GET /api/einvoice/status/:invoice_id returns status for submitted invoice', async () => {
    const invoiceId = `INV_STAT_${Date.now()}`;
    await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: '12345678901234'
      });

    const response = await request(app)
      .get(`/api/einvoice/status/${invoiceId}`)
      .set('Authorization', `Bearer ${merchantToken}`);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.data.invoice_id, invoiceId);
    assert.strictEqual(response.body.data.einvoice_status, 'submitted');
    assert.ok(response.body.data.submission_id);
  });

  it('INV-09: GET /api/einvoice/status/:invoice_id for non-existent invoice returns 404', async () => {
    const response = await request(app)
      .get('/api/einvoice/status/INV_NONEXISTENT_999999')
      .set('Authorization', `Bearer ${merchantToken}`);

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'Invoice not found');
  });

  it('INV-10: Cross-merchant invoice status access is denied with 403', async () => {
    const invoiceId = `INV_CROSS_${Date.now()}`;
    await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        invoice_id: invoiceId,
        customer_siret: '12345678901234'
      });

    const response = await request(app)
      .get(`/api/einvoice/status/${invoiceId}`)
      .set('Authorization', `Bearer ${otherMerchantToken}`);

    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.error, 'Access denied');
  });
});
