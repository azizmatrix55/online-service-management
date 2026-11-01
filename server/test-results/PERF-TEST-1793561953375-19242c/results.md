# Sweeplune local performance evaluation

Run: PERF-TEST-1793561953375-19242c

Started: 2026-11-01T19:39:13.375Z

Local prototype evaluation only. Does not measure cloud hosting, browser rendering, real network conditions, or unlimited production capacity.

## Environment and workload

- Node: v24.19.0; OS: win32 10.0.26200
- CPU: 11th Gen Intel(R) Core(TM) i5-11400F @ 2.60GHz; logical CPUs: 12
- Memory: 15.8 GiB
- Database: perf_test_1793561953375_19242c
- Verified bookings: 1000
- Virtual users: 10; planned duration: 30 seconds
- Think time: 100 ms after each request; each user alternates endpoints
- Warmup and authentication excluded; response download and validation included
- Peak simultaneous measured requests: 10

## Results

| Endpoint | Requests | Errors | Median ms | p95 ms | Valid under 2 s | Latency target |
|---|---:|---:|---:|---:|---:|---|
| /api/services | 1170 | 0 | 18.72 | 22.59 | 100.00% | MET |
| /api/bookings?page=1&limit=20 | 1160 | 0 | 27.53 | 36.11 | 100.00% | MET |

Overall verdict: PASS.

Isolated API stopped. Test database retained for reproducibility. No existing application records were modified.

Complete environment, exact measurements, source hash, and request samples are in results.json. No passwords or session cookies are recorded.
