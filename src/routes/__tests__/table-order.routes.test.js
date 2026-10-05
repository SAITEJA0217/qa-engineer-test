process.env.NODE_ENV = 'test';
import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../server.js';

describe('Table Order Routes - /api/table-orders', () => {
  let merchantId1;
  let merchantToken1;
  let merchantId2;
  let merchantToken2;

  before(async () => {
    // Merchant 1
    const res1 = await request(app)
      .post('/api/auth/register')
      .send({
        email: `table_merchant1_${Date.now()}@eupay.com`,
        password: 'Password123!',
        business_name: 'Bistro One'
      });
    merchantId1 = res1.body.user.id;
    merchantToken1 = res1.body.token;

    // Merchant 2
    const res2 = await request(app)
      .post('/api/auth/register')
      .send({
        email: `table_merchant2_${Date.now()}@eupay.com`,
        password: 'Password123!',
        business_name: 'Bistro Two'
      });
    merchantId2 = res2.body.user.id;
    merchantToken2 = res2.body.token;
  });

  it('ORDER-01: First pending order creation succeeds with 201 Created', async () => {
    const tableNumber = 101;
    const response = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1,
        table_number: tableNumber,
        items: [
          { name: 'Espresso', price: 3.5, quantity: 2 },
          { name: 'Croissant', price: 4.0, quantity: 1 }
        ],
        customer_name: 'Alice',
        order_type: 'dine_in'
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.merchant_id, merchantId1);
    assert.strictEqual(response.body.data.table_number, tableNumber);
    assert.strictEqual(response.body.data.status, 'pending');
    assert.strictEqual(response.body.data.total, 11.0);
  });

  it('ORDER-02: Duplicate pending order for same merchant and table is rejected with 409 Conflict (Bug F Regression)', async () => {
    const tableNumber = 102;

    // Initial pending order
    const firstOrder = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1,
        table_number: tableNumber,
        items: [{ name: 'Pasta', price: 15.0, quantity: 1 }]
      });
    assert.strictEqual(firstOrder.status, 201);

    // Attempt second pending order for same table & merchant
    const duplicateOrder = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1,
        table_number: tableNumber,
        items: [{ name: 'Pizza', price: 18.0, quantity: 1 }]
      });

    assert.strictEqual(duplicateOrder.status, 409);
    assert.strictEqual(duplicateOrder.body.error, 'Table already has a pending order');
  });

  it('ORDER-03: Different table for same merchant succeeds with 201', async () => {
    const response = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1,
        table_number: 103, // Different table
        items: [{ name: 'Soup', price: 8.0, quantity: 1 }]
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.data.table_number, 103);
  });

  it('ORDER-04: Same table number for different merchant succeeds with 201', async () => {
    // Table 101 was created for Merchant 1 in ORDER-01. Now create table 101 for Merchant 2
    const response = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId2,
        table_number: 101, // Same table number, different merchant
        items: [{ name: 'Tea', price: 4.0, quantity: 2 }]
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.data.merchant_id, merchantId2);
    assert.strictEqual(response.body.data.table_number, 101);
  });

  it('ORDER-05: After existing order becomes served/non-pending, a new order for same merchant/table succeeds with 201 (Bug F Boundary Test)', async () => {
    const tableNumber = 105;

    // 1. Create first pending order
    const initialOrder = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1,
        table_number: tableNumber,
        items: [{ name: 'Burger', price: 12.0, quantity: 1 }]
      });
    assert.strictEqual(initialOrder.status, 201);
    const orderId = initialOrder.body.data.id;

    // 2. Transition status from 'pending' -> 'served'
    const patchRes = await request(app)
      .patch(`/api/table-orders/${orderId}/status`)
      .set('Authorization', `Bearer ${merchantToken1}`)
      .send({ status: 'served' });
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchRes.body.data.status, 'served');

    // 3. New pending order for table 105 should now be accepted
    const nextOrder = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1,
        table_number: tableNumber,
        items: [{ name: 'Dessert', price: 6.5, quantity: 2 }]
      });

    assert.strictEqual(nextOrder.status, 201);
    assert.strictEqual(nextOrder.body.data.table_number, tableNumber);
    assert.strictEqual(nextOrder.body.data.status, 'pending');
  });

  it('ORDER-06: Order creation with missing required fields is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1
        // missing table_number and items
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'merchant_id, table_number, and items array required');
  });

  it('ORDER-07: Order creation with empty items array is rejected with 400', async () => {
    const response = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1,
        table_number: 109,
        items: []
      });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Order must have at least one item');
  });

  it('ORDER-08: GET /api/table-orders returns list of merchant orders', async () => {
    const response = await request(app)
      .get('/api/table-orders')
      .set('Authorization', `Bearer ${merchantToken1}`);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.ok(Array.isArray(response.body.data));
  });

  it('ORDER-09: PATCH /api/table-orders/:id/status with invalid status is rejected with 400', async () => {
    const newOrder = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: merchantId1,
        table_number: 110,
        items: [{ name: 'Salad', price: 9.0, quantity: 1 }]
      });
    const orderId = newOrder.body.data.id;

    const response = await request(app)
      .patch(`/api/table-orders/${orderId}/status`)
      .set('Authorization', `Bearer ${merchantToken1}`)
      .send({ status: 'unknown_status' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Valid status required');
  });
});
