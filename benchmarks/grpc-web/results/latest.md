# gRPC-Web benchmark report

Generated: 2026-09-08T09:06:20.240Z

## Configuration

- Runtime: v23.11.0
- Platform: darwin 25.5.0
- CPU: Apple M3 (8 logical CPUs)
- Concurrency: 32
- Measurement: 3 rounds × 3 seconds
- Warmup: 1 seconds per scenario
- Payload: 256 bytes
- Stream length: 16 messages
- Envoy: envoy  version: b579d07d3ad7ee11d32b105e91a5a39ad24718d7/1.39.1/Distribution/RELEASE/BoringSSL
- Topology: separate load-generator, direct-dispatch server, native backend, forwarding proxy, and Envoy processes; HTTP/1.1 gRPC-Web ingress; direct dispatch has no native gRPC loopback

Gzip applies to the gRPC-Web request message. Stream responses are not compressed by this dimension.

## Results

| Workload | Path | Transport | Request compression | Operations/s | Messages/s | Average | p50 | p95 | p99 | vs native | vs forward | Compression delta | Errors |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| unary | native | gRPC | none | 6803.4 | 6803.4 | 4.70 ms | 3.93 ms | 8.23 ms | 13.05 ms | 100.0% | — | — | 0 |
| stream | native | gRPC | none | 4800.8 | 76812.2 | 6.66 ms | 5.66 ms | 10.17 ms | 18.78 ms | 100.0% | — | — | 0 |
| unary | direct | gRPC-Web raw | none | 7454.0 | 7454.0 | 4.29 ms | 2.93 ms | 9.43 ms | 14.77 ms | 109.6% | +28.8% | — | 0 |
| stream | direct | gRPC-Web raw | none | 5297.2 | 84755.5 | 6.04 ms | 4.57 ms | 11.45 ms | 20.16 ms | 110.3% | +99.9% | — | 0 |
| unary | forward | gRPC-Web raw | none | 5786.6 | 5786.6 | 5.53 ms | 3.91 ms | 13.13 ms | 21.98 ms | 85.1% | — | — | 0 |
| stream | forward | gRPC-Web raw | none | 2649.3 | 42389.2 | 12.05 ms | 8.90 ms | 31.44 ms | 58.65 ms | 55.2% | — | — | 0 |
| unary | envoy | gRPC-Web raw | none | 6787.2 | 6787.2 | 4.71 ms | 3.13 ms | 11.73 ms | 17.75 ms | 99.8% | +17.3% | — | 0 |
| stream | envoy | gRPC-Web raw | none | 4309.5 | 68952.4 | 7.42 ms | 5.27 ms | 18.75 ms | 32.22 ms | 89.8% | +62.7% | — | 0 |
| unary | direct | gRPC-Web raw | gzip | 5644.9 | 5644.9 | 5.66 ms | 4.22 ms | 12.52 ms | 24.42 ms | 83.0% | +53.5% | -24.3% | 0 |
| stream | direct | gRPC-Web raw | gzip | 4308.6 | 68937.8 | 7.42 ms | 5.60 ms | 14.54 ms | 29.94 ms | 89.7% | +112.6% | -18.7% | 0 |
| unary | forward | gRPC-Web raw | gzip | 3676.6 | 3676.6 | 8.69 ms | 6.04 ms | 22.45 ms | 48.43 ms | 54.0% | — | -36.5% | 0 |
| stream | forward | gRPC-Web raw | gzip | 2026.8 | 32429.4 | 15.77 ms | 11.30 ms | 39.90 ms | 66.11 ms | 42.2% | — | -23.5% | 0 |
| unary | envoy | gRPC-Web raw | gzip | 5119.9 | 5119.9 | 6.25 ms | 4.78 ms | 13.02 ms | 20.00 ms | 75.3% | +39.3% | -24.6% | 0 |
| stream | envoy | gRPC-Web raw | gzip | 3253.9 | 52061.9 | 9.83 ms | 8.13 ms | 16.55 ms | 38.20 ms | 67.8% | +60.5% | -24.5% | 0 |
| unary | direct | gRPC-Web base64 | none | 6604.1 | 6604.1 | 4.84 ms | 3.97 ms | 8.53 ms | 15.29 ms | 97.1% | +52.9% | — | 0 |
| stream | direct | gRPC-Web base64 | none | 3650.1 | 58401.0 | 8.76 ms | 7.83 ms | 15.89 ms | 24.98 ms | 76.0% | +140.3% | — | 0 |
| unary | forward | gRPC-Web base64 | none | 4320.1 | 4320.1 | 7.40 ms | 6.23 ms | 13.57 ms | 25.70 ms | 63.5% | — | — | 0 |
| stream | forward | gRPC-Web base64 | none | 1518.7 | 24299.3 | 21.04 ms | 16.34 ms | 39.59 ms | 85.28 ms | 31.6% | — | — | 0 |
| unary | envoy | gRPC-Web base64 | none | 4867.6 | 4867.6 | 6.57 ms | 4.85 ms | 13.77 ms | 26.02 ms | 71.5% | +12.7% | — | 0 |
| stream | envoy | gRPC-Web base64 | none | 3026.3 | 48420.3 | 10.56 ms | 9.48 ms | 16.35 ms | 34.29 ms | 63.0% | +99.3% | — | 0 |
| unary | direct | gRPC-Web base64 | gzip | 4806.9 | 4806.9 | 6.63 ms | 5.68 ms | 10.77 ms | 21.03 ms | 70.7% | +64.8% | -27.2% | 0 |
| stream | direct | gRPC-Web base64 | gzip | 2662.6 | 42601.0 | 12.00 ms | 11.56 ms | 18.82 ms | 36.37 ms | 55.5% | +116.1% | -27.1% | 0 |
| unary | forward | gRPC-Web base64 | gzip | 2917.6 | 2917.6 | 10.95 ms | 9.20 ms | 20.60 ms | 63.12 ms | 42.9% | — | -32.5% | 0 |
| stream | forward | gRPC-Web base64 | gzip | 1232.0 | 19711.3 | 25.91 ms | 21.51 ms | 49.03 ms | 110.06 ms | 25.7% | — | -18.9% | 0 |
| unary | envoy | gRPC-Web base64 | gzip | 4142.9 | 4142.9 | 7.72 ms | 6.22 ms | 13.93 ms | 23.26 ms | 60.9% | +42.0% | -14.9% | 0 |
| stream | envoy | gRPC-Web base64 | gzip | 2348.1 | 37570.2 | 13.61 ms | 11.59 ms | 22.87 ms | 62.73 ms | 48.9% | +90.6% | -22.4% | 0 |

“Compression delta” compares a gzip-request scenario with the uncompressed scenario using the same workload, path implementation, and gRPC-Web encoding.
“vs forward” compares direct dispatch or Envoy with the project forwarding proxy using the same workload, encoding, and request compression.

