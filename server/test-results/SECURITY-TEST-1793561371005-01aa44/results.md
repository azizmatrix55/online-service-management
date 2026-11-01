# Sweeplune local API verification

Run: SECURITY-TEST-1793561371005-01aa44

Started: 2026-11-01T19:29:31.004Z

API: http://localhost:3000

Node: v24.19.0; platform: win32

HTTP integration checks; not a complete penetration test or performance benchmark.

Passed: 0; failed: 0; aborted: true.

| Test | Expected | Actual | Result |
|---|---|---|---|


Run stopped: fetch failed

## Test data

This run creates one customer, one service, and normally one booking. Records remain for traceability; there is no hard-delete API. The generated customer password is not stored or reported.

- Could not verify test service deactivation; check the fixture service ID manually.
