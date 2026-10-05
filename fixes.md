# Bug Fixes & Remediation Report (Bugs A–G)

This document details the root causes, remediations, manual verification results, and automated regression coverage for all seven intentional bugs identified during the EU Pay QA Engineer Technical Assessment.

---

## Bug A: Payment Amount Returned as String

- **Bug ID:** BUG-A
- **Title:** Payment amounts returned as strings instead of numbers
- **Original Behavior:** Endpoints `GET /api/payments` and `GET /api/payments/:id` returned the payment `amount` property formatted as string literals (e.g., `"amount": "25.5"`, `"amount": "100"`).
- **Root Cause:** In [`src/routes/payment.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/payment.routes.js), the response object formatting explicitly called `.toString()` on the stored numeric amounts (`amount: p.amount.toString()` and `amount: payment.amount.toString()`).
- **Fix Implemented:** Replaced `.toString()` with `parseFloat(...)` in both endpoint handlers to ensure payment amounts are consistently serialized as native JavaScript numbers in JSON responses.
- **File Changed:** [`src/routes/payment.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/payment.routes.js) (lines 15, 51)
- **Expected Behavior After Fix:** `amount` is returned as a JSON number (`typeof response.body.data[0].amount === "number"` and `typeof response.body.data.amount === "number"`).
- **Manual Verification Result:**
  - `GET /api/payments` -> HTTP 200, `"amount": 25.5` (number).
  - `GET /api/payments/1` -> HTTP 200, `"amount": 25.5` (number).
- **Automated Regression Tests:**
  - `PAY-01` (`src/routes/__tests__/payment.routes.test.js`): Asserts `typeof response.body.data[0].amount === "number"` on collection listing.
  - `PAY-02` (`src/routes/__tests__/payment.routes.test.js`): Asserts `typeof response.body.data.amount === "number"` on single payment retrieval.
- **Final Status:** **FIXED & REGRESSION-VERIFIED**

---

## Bug B: Missing Maximum Payment Amount Limit (€50,000)

- **Bug ID:** BUG-B
- **Title:** Missing upper boundary validation on payment creation amount
- **Original Behavior:** `POST /api/payments` accepted arbitrarily large amounts (e.g., €999,999 or €1,000,000,000) with HTTP 201 Created because only negative and non-numeric values were rejected.
- **Root Cause:** In [`src/routes/payment.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/payment.routes.js), the validation block checked `!amount || isNaN(amount) || amount <= 0` but omitted the business requirement enforcing the €50,000 maximum ceiling.
- **Fix Implemented:** Added an explicit boundary check immediately following basic number validation:
  ```javascript
  if (amount > 50000) {
    return res.status(400).json({ error: 'Amount exceeds maximum limit of €50,000' });
  }
  ```
- **File Changed:** [`src/routes/payment.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/payment.routes.js) (lines 74–76)
- **Expected Behavior After Fix:** Amounts `<= 50000` are accepted (HTTP 201); amounts `> 50000` are rejected (HTTP 400).
- **Manual Verification Result:**
  - `amount: 50000` -> HTTP 201 Created.
  - `amount: 50000.01` -> HTTP 400 Bad Request (`Amount exceeds maximum limit of €50,000`).
  - `amount: 999999` -> HTTP 400 Bad Request (`Amount exceeds maximum limit of €50,000`).
- **Automated Regression Tests:**
  - `PAY-04` (`src/routes/__tests__/payment.routes.test.js`): Amount €999,999 rejected with 400.
  - `PAY-04b` (`src/routes/__tests__/payment.routes.test.js`): Boundary amount €50,000.01 rejected with 400.
  - `PAY-05` (`src/routes/__tests__/payment.routes.test.js`): Exact boundary €50,000.00 accepted with 201.
  - `SEC-03` (`src/routes/__tests__/security.test.js`): Extreme amount €1,000,000,000 rejected with 400.
- **Final Status:** **FIXED & REGRESSION-VERIFIED**

---

## Bug C: Weak Email Validation in Merchant Registration

- **Bug ID:** BUG-C
- **Title:** Weak email validation allowing addresses missing top-level domain (TLD)
- **Original Behavior:** `POST /api/auth/register` accepted invalid email addresses without a domain extension, such as `baduser@domain` or `user@localhost`, resulting in HTTP 201 Created.
- **Root Cause:** In [`src/routes/auth.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/auth.routes.js), `validateEmail` used the overly permissive regular expression `/^[^\s@]+@[^\s@]+$/`, which only required an `@` symbol between non-whitespace characters without enforcing a dot-separated domain extension.
- **Fix Implemented:** Updated the regular expression in `validateEmail` to require a dot and valid domain suffix:
  ```javascript
  function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  ```
- **File Changed:** [`src/routes/auth.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/auth.routes.js) (line 10)
- **Expected Behavior After Fix:** Email addresses without a valid domain extension or TLD are rejected with HTTP 400 Bad Request.
- **Manual Verification Result:**
  - `email: "baduser@domain"` -> HTTP 400 Bad Request (`Invalid email format`).
  - `email: "valid_merchant@domain.com"` -> HTTP 201 Created.
- **Automated Regression Tests:**
  - `AUTH-02` (`src/routes/__tests__/auth.routes.test.js`): Email `baduser@domain` rejected with 400.
  - `AUTH-02b` (`src/routes/__tests__/auth.routes.test.js`): Email `plainaddress.com` rejected with 400.
  - `AUTH-01` (`src/routes/__tests__/auth.routes.test.js`): Valid email `valid_user@eupay.com` accepted with 201.
- **Final Status:** **FIXED & REGRESSION-VERIFIED**

---

## Bug D: Missing Webhook HMAC Signature Verification

- **Bug ID:** BUG-D
- **Title:** Webhook endpoint accepts unauthenticated/unverified requests
- **Original Behavior:** `POST /api/webhooks/payment-status` processed status updates without verifying the `x-webhook-signature` header, allowing forged or unsigned requests to modify payment statuses.
- **Root Cause:** In [`src/routes/webhook.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/webhook.routes.js), signature verification logic was disabled and commented out, returning HTTP 200 unconditionally.
- **Fix Implemented:**
  1. Enforced presence of the `x-webhook-signature` header, returning HTTP 401 when missing.
  2. Computed the expected HMAC-SHA256 digest using `crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest('hex')`.
  3. Verified signatures using `crypto.timingSafeEqual` with byte-length validation to prevent timing side-channel attacks:
  ```javascript
  if (!signature) {
    return res.status(401).json({ error: 'Signature required' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  ```
- **File Changed:** [`src/routes/webhook.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/webhook.routes.js) (lines 18–39)
- **Expected Behavior After Fix:** Missing, malformed, or invalid HMAC signatures return HTTP 401 Unauthorized; authentic signatures signed with `WEBHOOK_SECRET` proceed to processing.
- **Manual Verification Result:**
  - Request with missing signature -> HTTP 401 Unauthorized (`Signature required`).
  - Request with invalid signature -> HTTP 401 Unauthorized (`Invalid signature`).
  - Request with HMAC signed by wrong secret -> HTTP 401 Unauthorized (`Invalid signature`).
  - Request with correct HMAC-SHA256 signature -> HTTP 200 OK (`Webhook processed`).
- **Automated Regression Tests:**
  - `WEB-01` (`src/routes/__tests__/webhook.routes.test.js`): Missing signature -> 401.
  - `WEB-02` (`src/routes/__tests__/webhook.routes.test.js`): Invalid signature string -> 401.
  - `WEB-02b` (`src/routes/__tests__/webhook.routes.test.js`): Signature with incorrect secret -> 401.
  - `WEB-03` (`src/routes/__tests__/webhook.routes.test.js`): Valid HMAC-SHA256 signature -> 200.
- **Final Status:** **FIXED & REGRESSION-VERIFIED**

---

## Bug E: Missing Webhook Idempotency & Replay Prevention

- **Bug ID:** BUG-E
- **Title:** Missing webhook idempotency allowing repeated processing of identical event IDs
- **Original Behavior:** Submitting duplicate webhook deliveries with the same `event_id` resulted in repeated HTTP 200 responses and allowed payment status mutations from replayed events.
- **Root Cause:** In [`src/routes/webhook.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/webhook.routes.js), `event_id` validation and the `db.processed_webhooks` check and insertion were commented out.
- **Fix Implemented:**
  1. Validated that `event_id` is a non-empty string.
  2. Checked `db.processed_webhooks.includes(event_id)` and returned HTTP 409 Conflict if already present.
  3. Added `db.processed_webhooks.push(event_id)` upon successful processing:
  ```javascript
  if (!payment_id || !status || !event_id || typeof event_id !== 'string' || !event_id.trim()) {
    return res.status(400).json({ error: 'payment_id, status, and event_id required' });
  }

  if (db.processed_webhooks.includes(event_id)) {
    return res.status(409).json({ error: 'Webhook event already processed' });
  }
  ...
  db.processed_webhooks.push(event_id);
  ```
- **File Changed:** [`src/routes/webhook.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/webhook.routes.js) (lines 40–47, 58–59)
- **Expected Behavior After Fix:** First valid delivery returns HTTP 200; any subsequent delivery with the same `event_id` is rejected with HTTP 409 Conflict and does not alter the payment status.
- **Manual Verification Result:**
  - First delivery of `event_id: "evt_100"` -> HTTP 200 (`new_status: "completed"`).
  - Duplicate delivery of `event_id: "evt_100"` -> HTTP 409 Conflict (`Webhook event already processed`).
  - Tampered status (`failed`) with `event_id: "evt_100"` -> HTTP 409 Conflict; payment status remained `"completed"`.
  - 5 simultaneous concurrent deliveries with same `event_id` -> exactly 1x 200 OK and 4x 409 Conflict.
- **Automated Regression Tests:**
  - `WEB-04` (`src/routes/__tests__/webhook.routes.test.js`): Duplicate event rejected with 409.
  - `WEB-05` (`src/routes/__tests__/webhook.routes.test.js`): Tampered status with duplicate event ID rejected with 409 and status remains unchanged.
  - `WEB-06`, `WEB-07`, `WEB-08` (`src/routes/__tests__/webhook.routes.test.js`): Missing/empty/whitespace `event_id` rejected with 400.
  - `WEB-10` (`src/routes/__tests__/webhook.routes.test.js`): 5 concurrent duplicate requests via `Promise.all` yield 1x 200 and 4x 409.
- **Final Status:** **FIXED & REGRESSION-VERIFIED**

---

## Bug F: Duplicate Pending Table Orders Allowed

- **Bug ID:** BUG-F
- **Title:** Duplicate pending orders allowed for the same merchant and table
- **Original Behavior:** `POST /api/table-orders` allowed multiple simultaneous pending orders for the same `merchant_id` and `table_number`, causing order collision risks for restaurant staff.
- **Root Cause:** In [`src/routes/table-order.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/table-order.routes.js), the duplicate pending order check was commented out.
- **Fix Implemented:** Re-enabled the query checking for existing orders matching `merchant_id`, `table_number`, and `status === 'pending'`, returning HTTP 409 Conflict:
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
- **File Changed:** [`src/routes/table-order.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/table-order.routes.js) (lines 44–51)
- **Expected Behavior After Fix:** A table can only have one pending order per merchant at any time. Rejection returns HTTP 409 Conflict.
- **Manual Verification Result:**
  - First order for Table 1 -> HTTP 201 Created.
  - Second order for Table 1 (while pending) -> HTTP 409 Conflict (`Table already has a pending order`).
  - Order for Table 2 (same merchant) -> HTTP 201 Created.
  - Order for Table 1 (different merchant) -> HTTP 201 Created.
  - Once Table 1 status transitioned to `served`, new order for Table 1 -> HTTP 201 Created.
- **Automated Regression Tests:**
  - `ORDER-01` (`src/routes/__tests__/table-order.routes.test.js`): First pending order succeeds with 201.
  - `ORDER-02` (`src/routes/__tests__/table-order.routes.test.js`): Duplicate pending order for same table/merchant rejected with 409.
  - `ORDER-03` (`src/routes/__tests__/table-order.routes.test.js`): Different table for same merchant succeeds with 201.
  - `ORDER-04` (`src/routes/__tests__/table-order.routes.test.js`): Same table for different merchant succeeds with 201.
  - `ORDER-05` (`src/routes/__tests__/table-order.routes.test.js`): New order succeeds after prior order transitions to served.
- **Final Status:** **FIXED & REGRESSION-VERIFIED**

---

## Bug G: Duplicate E-Invoice Submissions Allowed

- **Bug ID:** BUG-G
- **Title:** Duplicate e-invoice submissions allowed for previously submitted invoices
- **Original Behavior:** `POST /api/einvoice/submit` allowed the same `invoice_id` to be submitted repeatedly to the tax authority simulator, generating duplicate submission IDs (`SUB-...`) and mutating submission timestamps.
- **Root Cause:** In [`src/routes/einvoice.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/einvoice.routes.js), the idempotency guard inspecting `einvoice_status` was commented out.
- **Fix Implemented:** Re-enabled the status check to block resubmission if `einvoice_status` is already `'submitted'` or `'accepted'`, returning HTTP 409 Conflict:
  ```javascript
  if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
    return res.status(409).json({ 
      error: 'Invoice already submitted to tax authority' 
    });
  }
  ```
- **File Changed:** [`src/routes/einvoice.routes.js`](file:///c:/P/A/qa-engineer-test/src/routes/einvoice.routes.js) (lines 43–48)
- **Expected Behavior After Fix:** Invoices in `submitted` or `accepted` status cannot be resubmitted and return HTTP 409 Conflict. Invoices that failed prior validation (e.g. invalid SIRET) can be corrected and submitted successfully.
- **Manual Verification Result:**
  - First submission with valid SIRET -> HTTP 200 OK (`status: "submitted"`).
  - Exact duplicate submission -> HTTP 409 Conflict (`Invoice already submitted to tax authority`).
  - Resubmission with modified SIRET -> HTTP 409 Conflict (`Invoice already submitted to tax authority`).
  - Submission of new invoice ID -> HTTP 200 OK.
  - Failed submission with 13-digit SIRET (HTTP 400) -> retried with valid 14-digit SIRET -> HTTP 200 OK.
- **Automated Regression Tests:**
  - `INV-01` (`src/routes/__tests__/einvoice.routes.test.js`): First valid submission succeeds with 200.
  - `INV-02` (`src/routes/__tests__/einvoice.routes.test.js`): Exact duplicate `invoice_id` rejected with 409.
  - `INV-03` (`src/routes/__tests__/einvoice.routes.test.js`): Duplicate with modified SIRET rejected with 409.
  - `INV-04` (`src/routes/__tests__/einvoice.routes.test.js`): Distinct invoice ID succeeds with 200.
  - `INV-05`, `INV-05b` (`src/routes/__tests__/einvoice.routes.test.js`): Invalid 13-digit / missing SIRET rejected with 400.
  - `INV-06` (`src/routes/__tests__/einvoice.routes.test.js`): Retry after 400 validation error succeeds with 200.
- **Final Status:** **FIXED & REGRESSION-VERIFIED**

---

## Summary Matrix of All Seven Bug Fixes

| Bug ID | Component | Vulnerability / Defect | Remediation | Primary File Changed | Regression Tests | Status |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| **A** | Payments | Amount returned as string | Parsed as numeric float in JSON output | `src/routes/payment.routes.js` | `PAY-01`, `PAY-02` | ✅ FIXED |
| **B** | Payments | Missing €50,000 max limit | Added upper bound check (`amount > 50000 -> 400`) | `src/routes/payment.routes.js` | `PAY-04`, `PAY-04b`, `PAY-05`, `SEC-03` | ✅ FIXED |
| **C** | Auth | Permissive email regex without TLD | Strengthened regex to `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | `src/routes/auth.routes.js` | `AUTH-02`, `AUTH-02b`, `AUTH-01` | ✅ FIXED |
| **D** | Webhooks | Missing HMAC signature check | Implemented HMAC-SHA256 & `crypto.timingSafeEqual` | `src/routes/webhook.routes.js` | `WEB-01`, `WEB-02`, `WEB-02b`, `WEB-03` | ✅ FIXED |
| **E** | Webhooks | Missing webhook idempotency | Added `event_id` validation & deduplication via `409` | `src/routes/webhook.routes.js` | `WEB-04`, `WEB-05`, `WEB-10` | ✅ FIXED |
| **F** | Table Orders| Duplicate pending table orders | Enforced single pending order per merchant/table | `src/routes/table-order.routes.js` | `ORDER-01`, `ORDER-02`, `ORDER-05` | ✅ FIXED |
| **G** | E-Invoice | Duplicate tax authority submission | Blocked resubmissions for `submitted`/`accepted` status | `src/routes/einvoice.routes.js` | `INV-01`, `INV-02`, `INV-03`, `INV-06` | ✅ FIXED |
