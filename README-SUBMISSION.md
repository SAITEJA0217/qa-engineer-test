# EU Pay — QA Engineer Intern Technical Assessment

## Candidate
**Saiteja Reddy Karka**

---

## Assessment Summary
This technical assessment involved full lifecycle quality assurance, security analysis, vulnerability remediation, and automated test engineering for the EU Pay Core REST API:
1. **Reconnaissance & Bug Hunting**: Thoroughly inspected the Express API codebase, middleware, in-memory data store, and routing logic to uncover seven intentional defects (Bugs A through G).
2. **Live Reproduction**: Manually reproduced and documented all seven defects with live HTTP requests, raw response payloads, and database state snapshots.
3. **Targeted Remediation**: Implemented precise, minimal production fixes across the authentication, payment, webhook, table order, and e-invoicing subsystems without altering existing API contracts or adding unnecessary dependencies.
4. **Automated Test Suite**: Built a comprehensive 62-test automated regression suite using Node.js's native test runner (`node:test`) and `supertest`.
5. **Security & Boundary Coverage**: Verified cryptographic signature checking, timing-safe equality, webhook idempotency, concurrency race conditions, SQL injection resilience, XSS input handling, Unicode support, and numeric boundary limits.
6. **Documentation Deliverables**: Compiled complete QA documentation including reconnaissance notes, reproduction reports, remediation details, test plans, and this submission overview.

---

## Bugs Fixed (A–G)

| Bug ID | Component | Summary of Issue & Fix | File Changed | Status |
| :---: | :--- | :--- | :--- | :---: |
| **A** | Payments | **Amount Return Type**: Payment amounts returned as strings. Fixed by parsing as numeric floats in JSON responses. | `src/routes/payment.routes.js` | ✅ FIXED |
| **B** | Payments | **Amount Limit**: Missing €50,000 maximum limit check. Fixed by adding upper boundary validation (`amount > 50000 -> 400`). | `src/routes/payment.routes.js` | ✅ FIXED |
| **C** | Authentication | **Email Validation**: Weak regex allowed emails without TLD (e.g., `user@domain`). Fixed with strict regex requiring domain extension. | `src/routes/auth.routes.js` | ✅ FIXED |
| **D** | Webhooks | **Signature Verification**: Webhooks processed without verifying HMAC signatures. Fixed using HMAC-SHA256 and `crypto.timingSafeEqual`. | `src/routes/webhook.routes.js` | ✅ FIXED |
| **E** | Webhooks | **Webhook Idempotency**: Duplicate event IDs processed repeatedly. Fixed by validating `event_id`, tracking processed IDs, and returning `409 Conflict`. | `src/routes/webhook.routes.js` | ✅ FIXED |
| **F** | Table Orders | **Duplicate Table Orders**: Allowed multiple simultaneous pending orders for the same table. Fixed by returning `409 Conflict` if table is pending. | `src/routes/table-order.routes.js` | ✅ FIXED |
| **G** | E-Invoice | **Duplicate E-Invoicing**: Allowed resubmission of already submitted invoices. Fixed by blocking resubmission for `submitted`/`accepted` status (`409 Conflict`). | `src/routes/einvoice.routes.js` | ✅ FIXED |

---

## Automated Testing

### Test Suite Execution Summary
- **Total Tests**: **62**
- **Passed**: **62**
- **Failed**: **0**
- **Skipped**: **0**
- **Execution Time**: **~1.3 seconds**

### Test Breakdown by Category
- **Authentication (`auth.routes.test.js`)**: 11 tests
- **Payments (`payment.routes.test.js`)**: 13 tests
- **Webhooks (`webhook.routes.test.js`)**: 12 tests
- **Table Orders (`table-order.routes.test.js`)**: 9 tests
- **E-Invoice (`einvoice.routes.test.js`)**: 11 tests
- **Security & Edge Cases (`security.test.js`)**: 6 tests

---

## Test Technology Stack
- **Test Runner**: Node.js built-in test runner (`node:test`)
- **Assertion Framework**: Node.js strict assertion library (`node:assert/strict`)
- **HTTP / API Simulation**: `supertest` (v6.3.4)
- **Cryptographic Operations**: Native Node.js `node:crypto`

---

## Security & Edge Coverage
- **Cryptographic Webhook Verification**: Enforced HMAC-SHA256 signature verification with byte-length checks and constant-time string comparison (`crypto.timingSafeEqual`) to protect against timing attacks.
- **Replay & Idempotency Protection**: Webhook deliveries with duplicated event IDs or altered payloads are rejected with HTTP 409 without mutating payment state.
- **Concurrency & Race Conditions**: Verified via 5 parallel identical webhook requests returning exactly 1x 200 OK and 4x 409 Conflict.
- **Input Sanitization & Injection Safety**: Verified that SQL injection-style payloads (`' OR '1'='1`) and XSS strings (`<script>alert(1)</script>`) do not bypass validation or disrupt server operations.
- **Unicode & Multilingual Strings**: Verified safe handling of emojis, accents, and non-ASCII character sets (`Café des Étoiles 🌟 お客様 Дмитрий`).
- **Boundary & Type Validation**: Validated exact numeric boundaries (€49,999.99, €50,000.00, €50,000.01), negative/zero numbers, 12/13/14/15-digit SIRET lengths, and large numeric identifiers.

---

## Key Verification Results
1. **All Bugs A–G Verified**: Manual live testing and automated regression testing confirm complete resolution of all 7 defects.
2. **Deterministic Webhook Concurrency**: 5 simultaneous deliveries with identical `event_id` result in exactly 1 accepted (HTTP 200) and 4 rejected (HTTP 409).
3. **Table Order Conflict Enforcement**: Duplicate pending table orders for the same merchant table return HTTP 409; transitioning status to `served` immediately permits new orders.
4. **E-Invoice Submission Deduplication**: Resubmission of existing invoices returns HTTP 409; retry of an invoice after fixing invalid SIRET succeeds with HTTP 200.

---

## Testability Enhancements in `src/server.js`
The only change made to [`src/server.js`](file:///c:/P/A/qa-engineer-test/src/server.js) was guarding `httpServer.listen()` so that importing `app` into `supertest` does not bind port 3000 or hang parallel test runners:
```javascript
const isDirectRun = process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('server.js')
);

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  httpServer.listen(PORT, () => { ... });
}
```
Direct execution via `node src/server.js` or `npm start` continues to start the server normally. No production business logic was modified.

---

## Project Documentation Architecture

- [`QA-RECONNAISSANCE.md`](file:///c:/P/A/qa-engineer-test/QA-RECONNAISSANCE.md): Phase 1 reconnaissance report detailing architecture, endpoints, database schema, data models, and live bug reproduction logs.
- [`bug-reports.md`](file:///c:/P/A/qa-engineer-test/bug-reports.md): Detailed individual bug reports with reproduction steps, expected vs. actual outcomes, severity, and evidence for Bugs A–G.
- [`fixes.md`](file:///c:/P/A/qa-engineer-test/fixes.md): Phase 2 remediation report detailing root causes, code diffs, verification evidence, and automated test mappings for Bugs A–G.
- [`test-plan.md`](file:///c:/P/A/qa-engineer-test/test-plan.md): Comprehensive 24-section QA test plan covering test strategy, functional/security/edge scenarios, and traceability matrix.
- [`README-SUBMISSION.md`](file:///c:/P/A/qa-engineer-test/README-SUBMISSION.md): High-level executive overview of the assessment submission.
- **Automated Test Files** (`src/routes/__tests__/*.test.js`): 62 automated test cases covering authentication, payments, webhooks, table orders, e-invoicing, and security.

---

## Running the Application & Test Suite

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Test Suite
```bash
npm test
```
*Note: Automated tests run directly against the Express application via Supertest; no manual server start is required.*

### 3. Start Development Server
```bash
npm start
```
*Starts the server on `http://localhost:3000` with interactive endpoint documentation.*

---

## Final Assessment Result
- **7/7 Bugs Fixed & Regression-Verified**
- **62/62 Automated Tests Passing (100% Pass Rate)**
- **0 New Dependencies Added**
- **Complete QA Documentation Provided**
- **Ready for Evaluator Review**
