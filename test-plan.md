# Quality Assurance Test Plan — EU Pay Core API

---

## 1. Document Purpose
This Quality Assurance Test Plan defines the testing scope, objectives, architectural test strategy, coverage categories, execution methodologies, and bug traceability for the EU Pay Technical Assessment API. It establishes the test framework used to validate core business functionality, security boundaries, idempotency controls, and regression prevention across the payment lifecycle.

---

## 2. Scope
The testing scope encompasses all RESTful API endpoints, authentication flows, payment operations, real-time table order management, webhook security/idempotency, and e-invoicing integrations provided in the EU Pay application:
- **In-Scope**:
  - Merchant Authentication & Session Management (`/api/auth/*`)
  - Payment Processing & Amount Validation (`/api/payments/*`)
  - Webhook Ingestion, HMAC Verification & Replay Protection (`/api/webhooks/*`)
  - Table Order Lifecycle & Concurrency (`/api/table-orders/*`)
  - B2B E-Invoicing & SIRET Validation (`/api/einvoice/*`)
  - Security Boundary & Input Sanitization Testing
  - Automated Regression Suite for Bugs A through G
- **Out-of-Scope**:
  - Live external third-party payment gateways (mocked/simulated)
  - Production PostgreSQL/MySQL persistence (in-memory test database)
  - Front-end mobile UI and client-side web browser rendering

---

## 3. Objectives
1. **Defect Verification & Remediation**: Verify and prevent regression of all seven identified intentional bugs (A through G).
2. **API Reliability & Contract Integrity**: Ensure 100% adherence to standard HTTP status codes, structured JSON payloads, and strict data typing.
3. **Security & Cryptographic Assurance**: Validate HMAC-SHA256 signature verification, timing-safe equality, authentication guards, and access isolation.
4. **Idempotency & Concurrency Resilience**: Prove the system handles duplicate, replayed, and parallel race-condition requests deterministically.
5. **High Automated Coverage**: Maintain an automated test suite of 60+ isolated, deterministic tests executing in under 2 seconds with zero test dependencies.

---

## 4. System Under Test (SUT)
- **Application Name**: EU Pay QA Test API (`eupay-qa-test`)
- **Version**: 1.0.0
- **Runtime Environment**: Node.js (v20+ ES Modules)
- **Core Frameworks**: Express 4.18.2, Socket.IO 4.7.2
- **Data Persistence**: In-memory JavaScript data store (`src/db/database.js`)
- **Authentication**: Stateless JSON Web Tokens (JWT) signed via `jsonwebtoken` and password hashing via `bcryptjs`

---

## 5. Technology & Test Tools
- **Test Runner**: Node.js Built-in Test Runner (`node:test`)
- **Assertion Library**: Strict Node Assertions (`node:assert/strict`)
- **HTTP Client / API Testing**: `supertest` (v6.3.4)
- **Cryptography**: Native Node.js `node:crypto` (HMAC-SHA256, `timingSafeEqual`)
- **Execution Command**: `npm test` (`node --test src/**/*.test.js`)

---

## 6. Test Strategy
Testing follows an API-centric integration approach using `supertest(app)` to send genuine HTTP requests through the full Express middleware stack (CORS, JSON body parser, authentication middleware, route handlers, error handlers):
- **Level of Testing**: Route-level integration and contract verification.
- **Test Isolation**: Every test creates its own unique entities (unique merchant emails, payment IDs, event IDs, table numbers, and invoice IDs) to eliminate inter-test coupling and race conditions.
- **Execution Efficiency**: Tests execute natively without spawning standalone daemon processes or binding static network ports.

---

## 7. Functional Testing
Functional testing verifies that the primary business workflows execute in accordance with the product specifications:
- Complete merchant signup, token generation, and login workflows.
- Single and list payment lookups for authorized merchants.
- Order creation with dynamic item price calculations.
- E-invoice dispatch to the simulated tax authority.

---

## 8. Authentication Testing (`src/routes/__tests__/auth.routes.test.js`)
- **AUTH-01**: Valid registration generates HTTP 201, user payload, and signed JWT token.
- **AUTH-02**: Registration rejects email without domain extension (e.g., `baduser@domain`) with HTTP 400 (Bug C).
- **AUTH-02b**: Registration rejects email missing `@` (e.g., `plainaddress.com`) with HTTP 400.
- **AUTH-03**: Login with registered credentials returns HTTP 200 and valid JWT token.
- **AUTH-04**: Login with invalid password returns HTTP 401 Unauthorized.
- **AUTH-05**: Duplicate email registration returns HTTP 409 Conflict.
- **AUTH-06**: Password with fewer than 8 characters returns HTTP 400 Bad Request.
- **AUTH-07**: Empty/short business name returns HTTP 400 Bad Request.
- **AUTH-08**: Non-existent user login returns HTTP 401 Unauthorized.
- **AUTH-09**: Missing email or password returns HTTP 400 Bad Request.

---

## 9. Payment Testing (`src/routes/__tests__/payment.routes.test.js`)
- **PAY-01**: `GET /api/payments` returns numeric `amount` (`typeof amount === "number"`) (Bug A).
- **PAY-02**: `GET /api/payments/:id` returns numeric `amount` (Bug A).
- **PAY-03**: Payment creation with valid amount (€100) returns HTTP 201 Created.
- **PAY-04**: Payment amount above €50,000 (€999,999) returns HTTP 400 Bad Request (Bug B).
- **PAY-04b**: Payment amount €50,000.01 (boundary +0.01) returns HTTP 400 Bad Request (Bug B).
- **PAY-05**: Payment amount exactly €50,000.00 returns HTTP 201 Created (Bug B).
- **PAY-06**: Zero payment amount (`0`) returns HTTP 400 Bad Request.
- **PAY-06b**: Negative payment amount (`-50`) returns HTTP 400 Bad Request.
- **PAY-07**: Payment creation without Authorization header returns HTTP 401 Unauthorized.
- **PAY-08**: Invalid currency code returns HTTP 400 Bad Request.
- **PAY-09**: Cross-merchant payment access returns HTTP 403 Forbidden.

---

## 10. Webhook Testing (`src/routes/__tests__/webhook.routes.test.js`)
- **WEB-01**: Missing `x-webhook-signature` returns HTTP 401 Unauthorized (Bug D).
- **WEB-02**: Tampered/invalid HMAC signature returns HTTP 401 Unauthorized (Bug D).
- **WEB-02b**: Signature generated with wrong secret returns HTTP 401 Unauthorized (Bug D).
- **WEB-03**: Valid HMAC-SHA256 signature successfully processes status update with HTTP 200 OK.
- **WEB-04**: Duplicate `event_id` returns HTTP 409 Conflict (Bug E).
- **WEB-05**: Replayed `event_id` with altered status is rejected (HTTP 409) and original payment status is immutable (Bug E).
- **WEB-06**: Missing `event_id` returns HTTP 400 Bad Request.
- **WEB-07**: Empty string `event_id` returns HTTP 400 Bad Request.
- **WEB-08**: Whitespace-only `event_id` returns HTTP 400 Bad Request.
- **WEB-09**: Validly signed webhook for non-existent payment returns HTTP 404 Not Found.
- **WEB-10**: Five concurrent identical webhook requests yield exactly 1x 200 OK and 4x 409 Conflict.
- **WEB-11**: E-invoice webhook status update (`POST /api/webhooks/e-invoice`) returns HTTP 200 OK.

---

## 11. Table-Order Testing (`src/routes/__tests__/table-order.routes.test.js`)
- **ORDER-01**: First pending order for merchant table returns HTTP 201 Created.
- **ORDER-02**: Second simultaneous pending order for same table/merchant returns HTTP 409 Conflict (Bug F).
- **ORDER-03**: Order for different table on same merchant returns HTTP 201 Created.
- **ORDER-04**: Order for same table number on different merchant returns HTTP 201 Created.
- **ORDER-05**: Once prior order is updated to `served`, a new pending order for the same table succeeds (HTTP 201).
- **ORDER-06**: Order payload missing required fields returns HTTP 400 Bad Request.
- **ORDER-07**: Order payload with empty `items` array returns HTTP 400 Bad Request.
- **ORDER-08**: `GET /api/table-orders` returns filtered list for authenticated merchant.
- **ORDER-09**: Invalid order status update returns HTTP 400 Bad Request.

---

## 12. E-Invoice Testing (`src/routes/__tests__/einvoice.routes.test.js`)
- **INV-01**: First valid e-invoice submission returns HTTP 200 OK with `submission_id`.
- **INV-02**: Exact duplicate `invoice_id` submission returns HTTP 409 Conflict (Bug G).
- **INV-03**: Same `invoice_id` submitted with altered SIRET returns HTTP 409 Conflict (Bug G).
- **INV-04**: New distinct `invoice_id` submission returns HTTP 200 OK.
- **INV-05**: Invalid 13-digit SIRET returns HTTP 400 Bad Request.
- **INV-05b**: Missing SIRET returns HTTP 400 Bad Request.
- **INV-06**: Retrying an invoice that failed 13-digit SIRET with a valid 14-digit SIRET succeeds with HTTP 200 OK.
- **INV-07**: Missing `invoice_id` returns HTTP 400 Bad Request.
- **INV-08**: `GET /api/einvoice/status/:invoice_id` returns submission details (HTTP 200).
- **INV-09**: Status query for non-existent invoice returns HTTP 404 Not Found.
- **INV-10**: Cross-merchant invoice query returns HTTP 403 Forbidden.

---

## 13. Security Testing (`src/routes/__tests__/security.test.js`)
- **SEC-01**: SQL injection payloads (`' OR '1'='1`) in login and registration fields do not bypass authentication or cause runtime exceptions.
- **SEC-02**: Cross-Site Scripting (XSS) payloads (`<script>alert("XSS")</script>`, `<img src=x onerror=...>`) are treated as literal strings and do not compromise response structures.
- **SEC-03**: Extreme payment values (€1,000,000,000) are blocked by maximum boundary validation.
- **SEC-04**: Unicode strings, emojis, and non-ASCII character sets (e.g. `Café des Étoiles 🌟 お客様 Дмитрий`) are safely persisted and retrieved.
- **SEC-05**: Null/empty `event_id` in webhook requests are rejected with HTTP 400.
- **SEC-06**: Massive/malformed resource identifiers do not cause uncaught exceptions or server crashes (returns HTTP 404 cleanly).

---

## 14. Edge-Case Testing
- **Payment Boundaries**: Tested €49,999.99 (accepted), €50,000.00 (accepted), and €50,000.01 (rejected).
- **Zero & Negative Numbers**: Explicitly tested `amount: 0` and `amount: -50.00`.
- **SIRET Lengths**: Validated 12-digit (rejected), 13-digit (rejected), 14-digit (accepted), and 15-digit (rejected).
- **Whitespace Strings**: Tested `event_id: "   "` and `business_name: " "` to prevent whitespace bypasses.

---

## 15. Integration Testing
- Verified cross-component lifecycles:
  1. Merchant registration -> Token issuance -> Payment creation -> Webhook status update -> Payment status verification.
  2. Table order placement -> Kitchen status progression (`pending` -> `preparing` -> `served`) -> New table order creation.
  3. Invoice creation -> E-invoice tax authority submission -> Webhook acknowledgement -> Status lookup.

---

## 16. Negative Testing
- Explicit verification of error responses:
  - HTTP 400 Bad Request (malformed bodies, missing fields, out-of-bound amounts, bad formats).
  - HTTP 401 Unauthorized (missing tokens, expired/invalid tokens, missing/bad HMAC signatures).
  - HTTP 403 Forbidden (accessing resources belonging to other merchants).
  - HTTP 404 Not Found (querying non-existent payments, orders, or invoices).
  - HTTP 409 Conflict (duplicate emails, duplicate webhooks, duplicate pending orders, duplicate e-invoices).

---

## 17. Regression Testing
Every bug fix implemented in Phase 2 has corresponding dedicated automated test cases running in CI/local runs to prevent regression:
- Regression suite runs via standard `npm test`.
- All 62 test cases must pass with 0 failures prior to any merge or release.

---

## 18. Concurrency & Race-Condition Testing
- **Parallel Webhook Delivery**: Tested simultaneous delivery of 5 identical webhook payloads using `Promise.all()`.
- **Assertion**: Guaranteed exactly 1 request returns HTTP 200 OK and remaining 4 requests return HTTP 409 Conflict without double-processing or database corruption.

---

## 19. Test Data Strategy
- In-memory database initialized via `initDatabase()`.
- Tests generate timestamped dynamic data (`Date.now()`) for emails, order tables, event IDs, and invoice IDs.
- Eliminates state contamination between test suites and allows parallel test execution.

---

## 20. Entry Criteria
- Code changes cleanly compiled and linted.
- Dependencies installed via `npm install`.
- No active port collisions.

---

## 21. Exit Criteria
- 100% of automated tests pass (62/62).
- Zero unhandled rejections or runtime errors.
- All 7 intentional bugs verified as remediated.
- Suite duration under 3.0 seconds.

---

## 22. Risks and Assumptions
- **Risk**: In-memory database state could persist between suites if tests reused static IDs.
  - **Mitigation**: All tests use dynamically generated unique identifiers.
- **Assumption**: Cryptographic operations rely on Node's native `crypto` module without third-party native binaries.

---

## 23. Automation Strategy
- Test suites are organized by domain under `src/routes/__tests__/`:
  - `auth.routes.test.js` (11 tests)
  - `payment.routes.test.js` (13 tests)
  - `webhook.routes.test.js` (12 tests)
  - `table-order.routes.test.js` (9 tests)
  - `einvoice.routes.test.js` (11 tests)
  - `security.test.js` (6 tests)
- Total Suite: **62 automated tests**.

---

## 24. Traceability Matrix (Bugs A–G to Automated Tests)

| Bug ID | Vulnerability / Defect | Production File | Automated Test Cases | Expected Outcome |
| :---: | :--- | :--- | :--- | :--- |
| **A** | Payment amount serialized as string | `src/routes/payment.routes.js` | `PAY-01`, `PAY-02` | `typeof amount === "number"` |
| **B** | Missing €50,000 maximum amount limit | `src/routes/payment.routes.js` | `PAY-04`, `PAY-04b`, `PAY-05`, `SEC-03` | <= €50k -> 201; > €50k -> 400 |
| **C** | Weak email regex without TLD | `src/routes/auth.routes.js` | `AUTH-02`, `AUTH-02b`, `AUTH-01` | No TLD -> 400; Valid -> 201 |
| **D** | Webhook missing HMAC verification | `src/routes/webhook.routes.js` | `WEB-01`, `WEB-02`, `WEB-02b`, `WEB-03` | Invalid/missing -> 401; Valid -> 200 |
| **E** | Webhook idempotency missing | `src/routes/webhook.routes.js` | `WEB-04`, `WEB-05`, `WEB-10` | Duplicate -> 409; Immutable status |
| **F** | Duplicate pending table orders | `src/routes/table-order.routes.js` | `ORDER-01`, `ORDER-02`, `ORDER-05` | Duplicate pending -> 409; Served -> 201 |
| **G** | Duplicate e-invoice submission | `src/routes/einvoice.routes.js` | `INV-01`, `INV-02`, `INV-03`, `INV-06` | Duplicate submitted -> 409; Retry -> 200 |
