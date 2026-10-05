# Bug Reports

## Bug A: Payment Amount Returned as String

**Location:** `src/routes/payment.routes.js` (lines 16, 52)  
**Severity:** Medium  
**Component:** Payment API  

### How to Reproduce:
1. Start server: `npm start`
2. Obtain a valid JWT token for a merchant (e.g. merchant `id: "1"`).
3. Send request:
   ```bash
   GET /api/payments
   Header: Authorization: Bearer <JWT_TOKEN>
   ```
4. Also send single payment lookup:
   ```bash
   GET /api/payments/1
   Header: Authorization: Bearer <JWT_TOKEN>
   ```
5. Inspect the `amount` property in the response payload.

### Expected Behavior:
Payment `amount` should be returned as a numeric data type (`typeof === 'number'`, e.g., `25.5` and `100.0`) in both the collection listing (`GET /api/payments`) and the single resource view (`GET /api/payments/:id`).

### Actual Behavior:
Payment `amount` is returned as a JSON string (`typeof === 'string'`, e.g., `"25.5"` and `"100"`).

### Impact:
Downstream consumer applications (web frontend dashboards, mobile SDKs, automated reconciliation services) expecting a numeric schema contract will encounter runtime errors, failed schema validations, or incorrect arithmetic operations (e.g., string concatenation `"25.5" + "100"` yielding `"25.5100"` instead of `125.5`, or `NaN` errors in financial calculations).

### Root Cause:
In `src/routes/payment.routes.js`:
- Line 16 explicitly casts the numeric database value to a string:
  ```javascript
  amount: p.amount.toString(),
  ```
- Line 52 in the `GET /api/payments/:id` handler also converts the number to string:
  ```javascript
  amount: payment.amount.toString(),
  ```

### Suggested Fix:
Maintain the native numeric float value directly from the database or parse with `parseFloat(p.amount)` / `Number(p.amount)`:
```javascript
// In GET /api/payments
amount: parseFloat(p.amount),

// In GET /api/payments/:id
amount: parseFloat(payment.amount),
```

### Evidence:
1. **Request to `GET /api/payments`**:
   - Status: `200 OK`
   - Response Body:
     ```json
     {
       "success": true,
       "data": [
         {
           "id": "1",
           "amount": "25.5",
           "currency": "EUR",
           "status": "completed",
           "customer_email": "customer1@test.com",
           "created_at": "2026-10-05T03:59:14.914Z"
         },
         {
           "id": "2",
           "amount": "100",
           "currency": "EUR",
           "status": "pending",
           "customer_email": "customer2@test.com",
           "created_at": "2026-10-05T03:59:14.914Z"
         }
       ],
       "count": 2
     }
     ```
   - Evaluation: `typeof data[0].amount` evaluates to `"string"`.

2. **Request to `GET /api/payments/1`**:
   - Status: `200 OK`
   - Response Body:
     ```json
     {
       "success": true,
       "data": {
         "id": "1",
         "amount": "25.5",
         "currency": "EUR",
         "status": "completed",
         "customer_email": "customer1@test.com",
         "created_at": "2026-10-05T03:59:14.914Z"
       }
     }
     ```
   - Evaluation: `typeof data.amount` evaluates to `"string"`.

---

## Bug B: Missing Maximum Payment Amount Validation

**Location:** `src/routes/payment.routes.js` (lines 70–74)  
**Severity:** High  
**Component:** Payment API  

### How to Reproduce:
1. Start server: `npm start`
2. Obtain a valid JWT token for an authenticated merchant.
3. Send a POST request to create a payment with an amount exceeding the maximum business limit of €50,000:
   ```bash
   POST /api/payments
   Header: Authorization: Bearer <JWT_TOKEN>
   Header: Content-Type: application/json
   Body: { "amount": 999999999, "currency": "EUR", "customer_email": "customer@example.com" }
   ```
4. Check the HTTP response status, body, and query the created payment via `GET /api/payments/<id>`.

### Test Cases:

| Test Case | Payload Amount | Expected Status | Actual Status | Payment Created? | Result |
|---|---|---|---|---|---|
| TEST 1 | `50` | `201 Created` | `201 Created` | Yes (ID: 3) | PASS |
| TEST 2 | `50000` | `201 Created` | `201 Created` | Yes (ID: 4) | PASS |
| TEST 3 | `50000.01` | `400 Bad Request` | `201 Created` | Yes (ID: 5) | **FAIL (Bug B Reproduced)** |
| TEST 4 | `999999` | `400 Bad Request` | `201 Created` | Yes (ID: 6) | **FAIL (Bug B Reproduced)** |
| TEST 5 | `999999999` | `400 Bad Request` | `201 Created` | Yes (ID: 7) | **FAIL (Bug B Reproduced)** |
| TEST 6 | `0` | `400 Bad Request` | `400 Bad Request` | No | PASS |
| TEST 7 | `-1` | `400 Bad Request` | `400 Bad Request` | No | PASS |

### Expected Behavior:
- Amounts up to and including €50,000 (`amount <= 50000`) should be accepted with `201 Created`.
- Amounts strictly greater than €50,000 (`amount > 50000`) must be rejected with `400 Bad Request` and a descriptive error message (e.g. `{"error": "Payment amount exceeds maximum limit of €50,000"}`).
- Non-positive amounts (0 or negative numbers) must remain rejected with `400 Bad Request`.

### Actual Behavior:
The API contains no ceiling check on `amount`. Any positive number—regardless of magnitude (e.g., €50,000.01, €999,999, or €999,999,999)—is accepted with `201 Created` and persisted into the database.

### Impact:
- **Financial and Compliance Risk**: Unrealistic and fraudulent transactions can be initiated without anti-money laundering (AML) controls or business ceiling safeguards.
- **Provider Gateway Failure**: Downstream payment processors (e.g. Powens, Stripe, SEPA Direct Debit networks) enforce maximum transaction caps and will fail with unhandled errors or suspend merchant accounts.
- **Data Integrity**: Allows merchants/users to pollute transaction ledgers with arbitrary large numbers.

### Root Cause:
In `src/routes/payment.routes.js`:
The validation block only checks for non-null, numeric, and positive values:
```javascript
if (!amount || isNaN(amount) || amount <= 0) {
  return res.status(400).json({ error: 'Valid amount is required' });
}
```
There is no upper bound validation rule (e.g. `amount > 50000`) before calling `createPayment()`.

### Suggested Fix:
Define a maximum transaction amount constant (e.g. `const MAX_PAYMENT_AMOUNT = 50000;`) and enforce the limit in `POST /api/payments`:
```javascript
const MAX_PAYMENT_AMOUNT = 50000;

if (!amount || isNaN(amount) || amount <= 0) {
  return res.status(400).json({ error: 'Valid amount is required' });
}

if (amount > MAX_PAYMENT_AMOUNT) {
  return res.status(400).json({ error: `Amount cannot exceed €${MAX_PAYMENT_AMOUNT.toLocaleString()}` });
}
```

### Evidence:
1. **TEST 5 Request (`amount: 999999999`)**:
   - Status: `201 Created`
   - Response:
     ```json
     {
       "success": true,
       "message": "Payment created",
       "data": {
         "id": "7",
         "amount": 999999999,
         "currency": "EUR",
         "status": "pending",
         "customer_email": "customer@example.com"
       }
     }
     ```
2. **Database Persistence Verification (`GET /api/payments/7`)**:
   - Status: `200 OK`
   - Response:
     ```json
     {
       "success": true,
       "data": {
         "id": "7",
         "amount": "999999999",
         "currency": "EUR",
         "status": "pending",
         "customer_email": "customer@example.com",
         "created_at": "2026-10-05T04:05:29.042Z"
       }
     }
     ```

---

## Bug C: Weak Email Validation

**Location:** `src/routes/auth.routes.js` (lines 9–14)  
**Severity:** Medium  
**Component:** Auth API  

### How to Reproduce:
1. Start server: `npm start`
2. Send a registration request with an email address missing a top-level domain (TLD):
   ```bash
   POST /api/auth/register
   Header: Content-Type: application/json
   Body: {
     "email": "user2@domain",
     "password": "SecurePass123!",
     "business_name": "QA Test Business"
   }
   ```
3. Observe the response status and verify that an account is created and a JWT token is returned.

### Test Cases:

| Test Case | Email Input | Expected Status | Actual Status | Account Created? | Result |
|---|---|---|---|---|---|
| TEST 1 | `valid1@example.com` | `201 Created` | `201 Created` | Yes (ID: 3) | PASS |
| TEST 2 | `user2@domain` | `400 Bad Request` | `201 Created` | Yes (ID: 4) | **FAIL (Bug C Reproduced)** |
| TEST 3 | `user3` | `400 Bad Request` | `400 Bad Request` | No | PASS |
| TEST 4 | `user4@` | `400 Bad Request` | `400 Bad Request` | No | PASS |
| TEST 5 | `@domain5.com` | `400 Bad Request` | `400 Bad Request` | No | PASS |
| TEST 6 | `user name6@example.com` | `400 Bad Request` | `400 Bad Request` | No | PASS |
| TEST 7 | `user7@example` | `400 Bad Request` | `201 Created` | Yes (ID: 5) | **FAIL (Bug C Reproduced)** |
| TEST 8 | `user8@example.com` | `201 Created` | `201 Created` | Yes (ID: 6) | PASS |

### Expected Behavior:
- Standard email addresses with valid domains and TLDs (e.g. `valid1@example.com`, `user8@example.com`) should be accepted with `201 Created`.
- Email addresses lacking a valid domain structure or top-level domain suffix (such as `user2@domain` and `user7@example`) must be rejected with `400 Bad Request` and `{"error": "Invalid email format"}`.
- Malformed strings (`user3`, `user4@`, `@domain5.com`, `user name6@example.com`) must remain rejected with `400 Bad Request`.

### Actual Behavior:
The email validation regular expression `/^[^\s@]+@[^\s@]+$/` only verifies the presence of an `@` symbol surrounded by non-whitespace characters. It does not enforce domain dot separation or a Top-Level Domain (TLD), causing invalid emails like `user2@domain` and `user7@example` to be accepted with `201 Created` and successfully registered into `db.users`.

### Impact:
- **Delivery and Communication Failure**: Verification emails, password reset links, invoices, and transaction receipts cannot be delivered to unreachable email addresses without a TLD.
- **Merchant Onboarding Integrity**: Fraudulent or accidental registrations pollute user databases with unusable contact records.
- **Account Recovery Issues**: Users registered with invalid emails will be permanently locked out if password recovery depends on email delivery.

### Root Cause:
In `src/routes/auth.routes.js`:
```javascript
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+$/;
  return emailRegex.test(email);
}
```
The regex allows any string as long as there is an `@` symbol between non-whitespace characters, without requiring a dot and a valid TLD suffix (e.g., `.com`, `.org`, `.eu`).

### Suggested Fix:
Implement an industry-standard RFC 5322 compliant regex or require at least one dot in the domain part followed by a 2+ character TLD:
```javascript
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return emailRegex.test(email);
}
```

### Evidence:
1. **Registration Request for `user2@domain`**:
   - Status: `201 Created`
   - Response:
     ```json
     {
       "message": "Registration successful",
       "user": {
         "id": "4",
         "email": "user2@domain",
         "business_name": "QA Test Business"
       },
       "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
     }
     ```
2. **Login Verification with `user2@domain`**:
   - Request: `POST /api/auth/login` with `{"email":"user2@domain","password":"SecurePass123!"}`
   - Status: `200 OK`
   - Response:
     ```json
     {
       "message": "Login successful",
       "user": {
         "id": "4",
         "email": "user2@domain",
         "business_name": "QA Test Business"
       },
       "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
     }
     ```

---

## Bug D: Webhook Signature Verification Missing

**Location:** `src/routes/webhook.routes.js` (lines 21–33)  
**Severity:** Critical  
**Component:** Webhooks  

### How to Reproduce:
1. Start server: `npm start`
2. Send an unauthorized or spoofed webhook POST request to `/api/webhooks/payment-status` with either no `x-webhook-signature` header or an arbitrary forged signature:
   ```bash
   POST /api/webhooks/payment-status
   Header: Content-Type: application/json
   Header: x-webhook-signature: invalid-signature
   Body: {
     "payment_id": "1",
     "status": "failed",
     "event_id": "evt_bug_d_002"
   }
   ```
3. Check the response status and observe that the request succeeds (`200 OK`) and mutates the payment record in the database.

### Test Cases:

| Test Case | Signature Header | Request Body Status | Expected Status | Actual Status | Webhook Accepted? | Payment Status Changed? | Result |
|---|---|---|---|---|---|---|---|
| TEST 1 | *(Missing)* | `"pending"` | `401 Unauthorized` | `200 OK` | Yes | Yes (`completed` $\rightarrow$ `pending`) | **FAIL (Bug D Reproduced)** |
| TEST 2 | `invalid-signature` | `"failed"` | `401 Unauthorized` | `200 OK` | Yes | Yes (`pending` $\rightarrow$ `failed`) | **FAIL (Bug D Reproduced)** |
| TEST 3 | `a1b2c3d4...` (64-char hex) | `"cancelled"` | `401 Unauthorized` | `200 OK` | Yes | Yes (`failed` $\rightarrow$ `cancelled`) | **FAIL (Bug D Reproduced)** |
| TEST 4 | HMAC with wrong secret | `"refunded"` | `401 Unauthorized` | `200 OK` | Yes | Yes (`cancelled` $\rightarrow$ `refunded`) | **FAIL (Bug D Reproduced)** |
| TEST 5 | HMAC with correct secret | `"completed"` | `200 OK` | `200 OK` | Yes | Yes (`refunded` $\rightarrow$ `completed`) | **PASS (Contract check)** |

### Expected Behavior:
- Inbound webhooks must cryptographically verify that the `x-webhook-signature` header matches the HMAC-SHA256 digest of the request payload computed with `WEBHOOK_SECRET`.
- Any request with a missing, malformed, forged, or incorrectly signed signature must be immediately rejected with `401 Unauthorized` (e.g. `{"error": "Invalid signature"}`), without modifying database state.
- Only correctly signed requests with matching HMAC-SHA256 signatures should be processed with `200 OK`.
- Cryptographic comparison should use constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

### Actual Behavior:
The endpoint completely ignores the `x-webhook-signature` header. Any external client can send unauthenticated HTTP POST requests with missing or arbitrary signatures, and the server will execute state transitions on arbitrary payment IDs.

### Impact:
- **Severe Security Vulnerability (Payment Spoofing)**: Malicious actors can spoof payment confirmations, marking unpaid orders as `completed`, or sabotage merchant operations by marking real transactions as `failed` or `refunded`.
- **Financial Fraud**: Attackers can trigger goods shipment or service fulfillment without real fund transfers.

### Root Cause:
In `src/routes/webhook.routes.js`:
The signature verification logic is commented out, and the route immediately proceeds to mutate `payment.status` without checking the `x-webhook-signature` header against HMAC calculation.

### Suggested Fix:
Enforce HMAC-SHA256 signature verification in `src/routes/webhook.routes.js` with secure constant-time comparison:
```javascript
const signature = req.headers['x-webhook-signature'];

if (!signature) {
  return res.status(401).json({ error: 'Signature required' });
}

const expectedSignature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');

const signatureBuffer = Buffer.from(signature);
const expectedBuffer = Buffer.from(expectedSignature);

if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

### Evidence:
1. **TEST 1 (Missing Signature)**:
   - Status: `200 OK`
   - Response: `{"success":true,"message":"Webhook processed","payment_id":"1","new_status":"pending"}`
   - Payment 1 status altered from `completed` to `pending`.
2. **TEST 2 (Fake Signature `invalid-signature`)**:
   - Status: `200 OK`
   - Response: `{"success":true,"message":"Webhook processed","payment_id":"1","new_status":"failed"}`
   - Payment 1 status altered from `pending` to `failed`.
3. **TEST 4 (HMAC with Wrong Secret)**:
   - Status: `200 OK`
   - Response: `{"success":true,"message":"Webhook processed","payment_id":"1","new_status":"refunded"}`
   - Payment 1 status altered from `cancelled` to `refunded`.

---

## Bug E: Webhook Idempotency Missing

**Location:** `src/routes/webhook.routes.js` (lines 38–45, 55–56)  
**Severity:** High  
**Component:** Webhooks  

### How to Reproduce:
1. Start server: `npm start`
2. Send a valid signed webhook event to `/api/webhooks/payment-status` with a specific `event_id` (e.g. `evt_bug_e_001`):
   ```bash
   POST /api/webhooks/payment-status
   Header: Content-Type: application/json
   Header: x-webhook-signature: <VALID_HMAC_SHA256>
   Body: { "payment_id": "2", "status": "completed", "event_id": "evt_bug_e_001" }
   ```
3. Send the exact duplicate request with the same `event_id` and payload again.
4. Send another request with the SAME `event_id` but conflicting `status: "failed"`.
5. Observe that every duplicate delivery is accepted and re-processed without detecting that `event_id` was already handled.

### Test Cases:

| Test Case | Payload | Before Status | Expected Status | Actual Status | Re-processed? | Result |
|---|---|---|---|---|---|---|
| TEST 1 (Initial Event) | `evt_bug_e_001`, `completed` | `pending` | `200 OK` | `200 OK` | Yes (Initial) | PASS |
| TEST 2 (Exact Duplicate) | `evt_bug_e_001`, `completed` | `completed` | `200 OK` (Already processed) / `409` | `200 OK` (Processed as new) | Yes | **FAIL (Bug E Reproduced)** |
| TEST 3 (Same ID, New Status) | `evt_bug_e_001`, `failed` | `completed` | `409 Conflict` / Ignored | `200 OK` (Mutated status) | Yes (`completed` $\rightarrow$ `failed`) | **FAIL (Bug E Reproduced)** |
| TEST 4 (New Event ID) | `evt_bug_e_002`, `failed` | `failed` | `200 OK` | `200 OK` | Yes (New ID) | PASS |
| TEST 5 (Duplicate New Event) | `evt_bug_e_002`, `failed` | `failed` | `200 OK` (Already processed) / `409` | `200 OK` (Processed as new) | Yes | **FAIL (Bug E Reproduced)** |

### Concurrent Delivery Test:
- **Execution**: 5 simultaneous asynchronous HTTP POST requests (`Promise.all()`) sending `{ "payment_id": "2", "status": "completed", "event_id": "evt_bug_e_concurrent_001" }` with valid HMAC signatures.
- **Observed Behavior**:
  - Request 1: `200 OK` (`{"success":true,"message":"Webhook processed","payment_id":"2","new_status":"completed"}`)
  - Request 2: `200 OK` (`{"success":true,"message":"Webhook processed","payment_id":"2","new_status":"completed"}`)
  - Request 3: `200 OK` (`{"success":true,"message":"Webhook processed","payment_id":"2","new_status":"completed"}`)
  - Request 4: `200 OK` (`{"success":true,"message":"Webhook processed","payment_id":"2","new_status":"completed"}`)
  - Request 5: `200 OK` (`{"success":true,"message":"Webhook processed","payment_id":"2","new_status":"completed"}`)
- **Summary**: **5 out of 5** requests were accepted and executed duplicate state updates. 0 were rejected or deduplicated.

### Expected Behavior:
- When a webhook request arrives with an `event_id` that has already been recorded in `db.processed_webhooks`:
  - The server should recognize the duplicate and return an idempotent response (e.g. `200 OK` with `{"message": "Already processed"}` or `409 Conflict`), without mutating payment status or triggering downstream notifications/events.
- When a new `event_id` arrives, it should process the status update and append the `event_id` to `db.processed_webhooks`.

### Actual Behavior:
- The idempotency check is commented out, and processed event IDs are never stored in `db.processed_webhooks`.
- Duplicate webhooks re-execute status updates, reset `payment.webhook_received_at`, and would trigger redundant business events (e.g., duplicated merchant notifications or duplicate fulfillment triggers).

### Impact:
- **Duplicate Processing & Race Conditions**: In real-world payment networks (e.g., Powens, Stripe), network retries frequently deliver duplicate webhook events. Lacking idempotency leads to repeated side effects (e.g. duplicate balance credits, conflicting state reversions, redundant webhook callbacks).
- **Out-of-Order Replay Vulnerability**: An attacker replaying an old event payload with the same `event_id` can regress a transaction's status.

### Root Cause:
In `src/routes/webhook.routes.js`:
The idempotency validation and storage lines are disabled in comments:
```javascript
// if (db.processed_webhooks.includes(event_id)) {
//   return res.status(200).json({ message: 'Already processed' });
// }
...
// db.processed_webhooks.push(event_id);
```

### Suggested Fix:
Enable idempotency tracking using `db.processed_webhooks` in `src/routes/webhook.routes.js`:
```javascript
if (event_id) {
  if (db.processed_webhooks.includes(event_id)) {
    return res.status(200).json({
      success: true,
      message: 'Already processed',
      event_id,
      payment_id
    });
  }
}

// After updating payment:
if (event_id) {
  db.processed_webhooks.push(event_id);
}
```

### Evidence:
1. **TEST 3 (Conflicting Status with Same Event ID `evt_bug_e_001`)**:
   - Request: `POST /api/webhooks/payment-status` with `status: "failed"`, `event_id: "evt_bug_e_001"`
   - Status: `200 OK`
   - Response: `{"success":true,"message":"Webhook processed","payment_id":"2","new_status":"failed"}`
   - Result: Payment 2 status was overwritten from `completed` to `failed`.
2. **5-Request Concurrent Batch**:
   - All 5 simultaneous requests with `evt_bug_e_concurrent_001` returned `200 OK` with `"message":"Webhook processed"`.

---

## Bug F: Duplicate Pending Table Orders

**Location:** `src/routes/table-order.routes.js` (lines 44–56)  
**Severity:** Medium  
**Component:** Table Orders  

### How to Reproduce:
1. Start server: `npm start`
2. Submit a table order for Merchant 1, Table 5:
   ```bash
   POST /api/table-orders
   Header: Content-Type: application/json
   Body: {
     "merchant_id": "1",
     "table_number": 5,
     "items": [{"name": "Margherita Pizza", "price": 12.5, "quantity": 2}],
     "customer_name": "Alice",
     "order_type": "dine_in"
   }
   ```
3. While the first order is still in `pending` status, submit a second order for the SAME merchant (`1`) and SAME table (`5`):
   ```bash
   POST /api/table-orders
   Header: Content-Type: application/json
   Body: {
     "merchant_id": "1",
     "table_number": 5,
     "items": [{"name": "Pasta Carbonara", "price": 14.0, "quantity": 1}],
     "customer_name": "Alice",
     "order_type": "dine_in"
   }
   ```
4. Query `GET /api/table-orders` with Merchant 1's Bearer token and inspect active orders for Table 5.

### Test Cases:

| Test Case | Merchant ID | Table Number | Prior Table State | Expected Status | Actual Status | Order Created? | Result |
|---|---|---|---|---|---|---|---|
| STEP 2 (First Order) | `1` | `5` | No pending order | `201 Created` | `201 Created` | Yes (`5ea5a40e...`) | PASS |
| STEP 3 (Duplicate Order) | `1` | `5` | Has pending order | `409 Conflict` | `201 Created` | Yes (`2365ada4...`) | **FAIL (Bug F Reproduced)** |
| STEP 5 (Order After Served) | `1` | `5` | Order status = `served` | `201 Created` | `201 Created` | Yes (`54763a7e...`) | PASS |
| STEP 6 (Different Table) | `1` | `6` | Table 5 had orders | `201 Created` | `201 Created` | Yes (`c0b39f0c...`) | PASS |
| STEP 7 (Different Merchant) | `2` | `5` | Merchant 1 had orders | `201 Created` | `201 Created` | Yes (`1a029f60...`) | PASS |

### Expected Behavior:
- If a table already has an active order in `pending` status for a specific merchant, any subsequent attempt to create another order for that same table and merchant must be rejected with `409 Conflict` (e.g. `{"error": "Table already has a pending order"}`).
- Once an existing order transitions to a non-pending state (`confirmed`, `preparing`, `ready`, `served`, or `cancelled`), creating a new pending order for that table should be allowed.
- Orders for different tables at the same merchant, or for the same table number across different merchants, must not be blocked.

### Actual Behavior:
The API allows creating unlimited simultaneous `pending` orders for the exact same merchant and table number, returning `201 Created` each time and generating separate active order records.

### Impact:
- **Kitchen & Operations Chaos**: Multiple overlapping pending tickets are sent to the restaurant kitchen for the same table, leading to duplicated food preparation, food waste, and customer billing disputes.
- **Table Session Inconsistency**: Real-time Socket.IO clients listening on `table_5` receive conflicting order updates and IDs.

### Root Cause:
In `src/routes/table-order.routes.js`:
The duplicate pending order validation check is commented out:
```javascript
// const existingOrder = (db.table_orders || []).find(
//   o => o.merchant_id === merchant_id && 
//        o.table_number === table_number && 
//        o.status === 'pending'
// );
// if (existingOrder) {
//   return res.status(409).json({ error: 'Table already has a pending order' });
// }
```

### Suggested Fix:
Enable duplicate pending order validation before instantiating `newOrder`:
```javascript
const existingOrder = (db.table_orders || []).find(
  o => o.merchant_id === merchant_id && 
       o.table_number === table_number && 
       o.status === 'pending'
);
if (existingOrder) {
  return res.status(409).json({ error: 'Table already has a pending order' });
}
```

### Evidence:
1. **First Order (`POST /api/table-orders`)**:
   - Status: `201 Created`
   - Data: `{"id": "5ea5a40e-fc4e-44bb-a670-e393901d10bd", "merchant_id": "1", "table_number": 5, "status": "pending", "total": 25}`
2. **Second Duplicate Order (`POST /api/table-orders`)**:
   - Status: `201 Created`
   - Data: `{"id": "2365ada4-9e20-4189-93af-fa4a5fb41cb6", "merchant_id": "1", "table_number": 5, "status": "pending", "total": 14}`
3. **Verification Query (`GET /api/table-orders`)**:
   - Both order IDs exist simultaneously in `pending` status for Table 5.

---

## Bug G: Duplicate E-Invoice Submission

**Location:** `src/routes/einvoice.routes.js` (lines 50–58)  
**Severity:** Medium  
**Component:** E-Invoice  

### How to Reproduce:
1. Start server: `npm start`
2. Submit a valid B2B e-invoice with a 14-digit customer SIRET:
   ```bash
   POST /api/einvoice/submit
   Header: Authorization: Bearer <JWT_TOKEN>
   Header: Content-Type: application/json
   Body: {
     "invoice_id": "INV-BUG-G-001",
     "customer_siret": "12345678901234"
   }
   ```
3. Send the exact same submission request again for the same `invoice_id` (`INV-BUG-G-001`).
4. Observe that the API accepts the duplicate submission with `200 OK` and generates a brand new `submission_id` instead of rejecting with `409 Conflict`.

### Test Cases:

| Test Case | Scenario / Invoice ID | Customer SIRET | Expected Status | Actual Status | Generated Submission ID | Result |
|---|---|---|---|---|---|---|
| STEP 2 | First Submission (`INV-BUG-G-001`) | `12345678901234` | `200 OK` | `200 OK` | `SUB-20bad743-c849-41b9-ba8d-2263b87a05af` | PASS |
| STEP 3 | Duplicate Submission (`INV-BUG-G-001`) | `12345678901234` | `409 Conflict` | `200 OK` | `SUB-cd488c80-b1bb-47a0-ba3f-8cc2c52fb5e1` | **FAIL (Bug G Reproduced)** |
| STEP 5 | Modified Data Submission (`INV-BUG-G-001`) | `98765432109876` | `409 Conflict` | `200 OK` | `SUB-1413a62a-ae4e-4b0c-b93f-d2d14a2870e7` | **FAIL (Bug G Reproduced)** |
| STEP 6 | Control: New Invoice (`INV-BUG-G-002`) | `12345678901234` | `200 OK` | `200 OK` | `SUB-ba98245d-b750-45a0-97b0-0de7cdef8c0d` | PASS |
| STEP 7 | Control: Invalid SIRET (`INV-BUG-G-003`, 13 digits) | `1234567890123` | `400 Bad Request` | `400 Bad Request` | None | PASS |

### Expected Behavior:
- Once an invoice has been submitted to the tax authority (`einvoice_status === 'submitted'` or `'accepted'`), any subsequent attempt to submit the same `invoice_id` must be rejected with `409 Conflict` (e.g. `{"error": "Invoice already submitted to tax authority"}`).
- Distinct invoices (e.g. `INV-BUG-G-002`) from the same merchant should proceed normally.
- Requests with invalid SIRET formats (non-14 digits) must be rejected with `400 Bad Request`.

### Actual Behavior:
The e-invoice submission endpoint does not check `invoice.einvoice_status` prior to initiating submission. It allows repeatedly re-submitting previously filed invoices, continually assigning new `submission_id` tokens and overwriting `invoice.submitted_at` timestamps.

### Impact:
- **Tax Authority Non-Compliance & Audit Penalties**: Submitting duplicate electronic invoices to government tax portals (e.g. French Seqino PDP / Chorus Pro) leads to tax authority rejections, duplicate VAT accounting entries, or regulatory compliance fines.
- **Accounting Discrepancies**: Overwrites the original filing audit trail (`submitted_at`, `submission_id`) with new timestamps, destroying legally required submission proof.

### Root Cause:
In `src/routes/einvoice.routes.js`:
The validation condition preventing duplicate submissions is commented out:
```javascript
// if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
//   return res.status(409).json({ 
//     error: 'Invoice already submitted to tax authority' 
//   });
// }
```

### Suggested Fix:
Enforce duplicate submission validation in `src/routes/einvoice.routes.js`:
```javascript
if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
  return res.status(409).json({ 
    error: 'Invoice already submitted to tax authority' 
  });
}
```

### Evidence:
1. **Initial Submission 1 Response**:
   - Status: `200 OK`
   - Data: `{"invoice_id": "INV-BUG-G-001", "submission_id": "SUB-20bad743-c849-41b9-ba8d-2263b87a05af", "status": "submitted"}`
2. **Duplicate Submission 2 Response**:
   - Status: `200 OK`
   - Data: `{"invoice_id": "INV-BUG-G-001", "submission_id": "SUB-cd488c80-b1bb-47a0-ba3f-8cc2c52fb5e1", "status": "submitted"}`
3. **Audit Status Query (`GET /api/einvoice/status/INV-BUG-G-001`)**:
   - Status: `200 OK`
   - Shows latest `submission_id: "SUB-cd488c80-b1bb-47a0-ba3f-8cc2c52fb5e1"` overwrote the first submission.






