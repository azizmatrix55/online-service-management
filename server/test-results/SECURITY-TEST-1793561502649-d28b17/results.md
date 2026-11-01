# Sweeplune local API verification

Run: SECURITY-TEST-1793561502649-d28b17

Started: 2026-11-01T19:31:42.648Z

API: http://localhost:3000

Node: v24.19.0; platform: win32

HTTP integration checks; not a complete penetration test or performance benchmark.

Passed: 28; failed: 0; aborted: false.

| Test | Expected | Actual | Result |
|---|---|---|---|
| Empty address | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Address too long | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Notes too long | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Notes with wrong type | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Past appointment | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Invalid calendar date | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Timestamp without offset | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Malformed service ID | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Client-supplied booking status | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Client-supplied customer identity | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Nonexistent service | HTTP 400 SERVICE_UNAVAILABLE | HTTP 400 SERVICE_UNAVAILABLE | PASS |
| Missing CSRF token | HTTP 403 CSRF_REJECTED | HTTP 403 CSRF_REJECTED | PASS |
| Incorrect CSRF token | HTTP 403 CSRF_REJECTED | HTTP 403 CSRF_REJECTED | PASS |
| Incorrect Origin with valid token | HTTP 403 CSRF_REJECTED | HTTP 403 CSRF_REJECTED | PASS |
| Rejected requests created no bookings | 0 bookings for the new test customer | 0 bookings | PASS |
| Valid request persists as pending | HTTP 201 | HTTP 201 | PASS |
| Saved booking has trusted identity and snapshot | test customer, test service, pending, initial history | Read from admin booking list | PASS |
| Customer cannot update booking status | HTTP 403 ADMIN_REQUIRED | HTTP 403 ADMIN_REQUIRED | PASS |
| Pending cannot become completed | HTTP 400 INVALID_TRANSITION | HTTP 400 INVALID_TRANSITION | PASS |
| Status update requires version | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | PASS |
| Rejected transitions did not change the record | same pending status, version and history | status=pending; version=0 | PASS |
| Concurrent decisions accept exactly one update | HTTP 200 and HTTP 409 BOOKING_CONFLICT | 200, 409 | PASS |
| Concurrent update appends exactly one history entry | confirmed; version +1; history +1 | status=confirmed; version=1; history=2 | PASS |
| Confirmed can become completed | HTTP 200 | HTTP 200 | PASS |
| Completed booking cannot reopen | HTTP 400 INVALID_TRANSITION | HTTP 400 INVALID_TRANSITION | PASS |
| Deactivated test service is hidden from catalogue | test service absent | HTTP 200 | PASS |
| Inactive service cannot be booked | HTTP 400 SERVICE_UNAVAILABLE | HTTP 400 SERVICE_UNAVAILABLE | PASS |
| Customer history retains the completed booking | one completed test booking with original label | 1 bookings | PASS |

## Test data

This run creates one customer, one service, and normally one booking. Records remain for traceability; there is no hard-delete API. The generated customer password is not stored or reported.

- This run’s test service is inactive.
- Test booking 6ae7939f00e6ec062c166fbf is closed (completed or cancelled).
