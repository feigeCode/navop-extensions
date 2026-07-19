# Remote desktop performance results

Date: 2026-07-19

## Environment

- Host: Apple Silicon macOS
- Container runtime: Docker Desktop
- Resolution: 1280x720
- Benchmark duration: 10 seconds per primary run
- Activity: mouse movement every 33 ms and periodic wheel input
- RDP image: docker.1ms.run/danielguerra/ubuntu-xrdp:latest
- VNC image: docker.m.daocloud.io/dorowu/ubuntu-desktop-lxde-vnc:latest
- Both server images are amd64 and run through Docker Desktop Rosetta.

The helper metrics are measured at the provider stdin/stdout protocol boundary. Frame
counts therefore represent frames delivered by the helper after mailbox coalescing,
not the RDP or VNC server's internal capture rate.

## RDP compatibility fix

The original Docker RDP run terminated before the first frame. Full error reporting
showed that the failure was not a Fast-Path graphics decode error:

~~~text
invalid ServerAudioOutputPdu::msgType: Unknown audio output PDU type
~~~

IronRDP registered the rdpsnd static channel even when
enable_audio_playback=false. The client now omits rdpsnd in that mode. The helper
also waits for its output mapper to drain, so terminal errors are not lost when the
client runtime exits.

The RDP helper is pinned to:

- Repository: https://github.com/feigeCode/IronRDP
- Branch: navop-filecopy
- Revision: 5f4b61a6cd288276e5d7a4253441f9148d404ecf

This revision also contains the clipboard file-copy input event used by the RDP
provider.

## Real Docker RDP

The baseline helper was built from the provider commit before incremental frame
transport, while using the same fixed IronRDP revision. This isolates the full-frame
versus dirty-rectangle transport behavior.

### Baseline runs

| Run | First frame | Frames | Full | Delta | Payload bytes | Wire bytes | MiB/s | CPU | Max RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1482 ms | 11 | 11 | 0 | 40,550,400 | 40,551,564 | 3.87 | 0.62% | 33,744 KiB |
| 2 | 771 ms | 10 | 10 | 0 | 36,864,000 | 36,865,093 | 3.52 | 0.61% | 33,856 KiB |
| 3 | 767 ms | 10 | 10 | 0 | 36,864,000 | 36,865,093 | 3.52 | 0.62% | 33,760 KiB |
| Average | 1006.67 ms | 10.33 | 10.33 | 0 | 38,092,800 | 38,093,916.67 | 3.63 | 0.62% | 33,786.67 KiB |

Every baseline frame carries the complete 1280x720 BGRA framebuffer:

~~~text
1280 * 720 * 4 = 3,686,400 bytes per frame
~~~

### Optimized runs

| Run | First frame | Frames | Full | Delta | Payload bytes | Wire bytes | MiB/s | CPU | Max RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 762 ms | 7 | 2 | 5 | 7,667,712 | 7,669,267 | 0.73 | 0.66% | 37,552 KiB |
| 2 | 754 ms | 6 | 2 | 4 | 7,602,176 | 7,603,541 | 0.73 | 0.43% | 37,632 KiB |
| 3 | 1422 ms | 6 | 2 | 4 | 7,602,176 | 7,603,541 | 0.73 | 0.58% | 37,616 KiB |
| Average | 979.33 ms | 6.33 | 2 | 4.33 | 7,624,021.33 | 7,625,449.67 | 0.73 | 0.56% | 37,600 KiB |

### RDP comparison

| Metric | Baseline average | Optimized average | Change |
| --- | ---: | ---: | ---: |
| Frame payload per 10 seconds | 38,092,800 B | 7,624,021 B | **-79.98%** |
| Protocol wire bytes per 10 seconds | 38,093,917 B | 7,625,450 B | **-79.98%** |
| Payload bandwidth | 3.63 MiB/s | 0.73 MiB/s | **-79.98%** |
| Payload per delivered frame | 3,686,400 B | 1,203,793 B | **-67.35%** |
| First-frame latency | 1006.67 ms | 979.33 ms | -2.71% |
| Helper CPU | 0.62% | 0.56% | -9.73% |
| Max RSS | 33,786.67 KiB | 37,600 KiB | +3,813.33 KiB (+11.29%) |

The optimized frame count is lower because the mailbox drops obsolete pending frames
and merges consecutive dirty rectangles. This is intentional backpressure behavior;
it should not be interpreted as the server rendering fewer frames.

## Synthetic RDP sparse-update benchmark

The deterministic release benchmark sends 60 sparse 1280x720 updates through the RDP
output mapper.

| Metric | Full-frame baseline | Dirty rectangles | Change |
| --- | ---: | ---: | ---: |
| Payload bytes | 221,184,000 | 5,029,888 | **-97.73%** |
| Latest measured CPU time | 65.32 ms | 39.79 ms | -39.09% |
| Earlier measured CPU time | 42.92 ms | 43.37 ms | +1.06% |

Payload reduction is deterministic. CPU timing is sensitive to host scheduling and
should be treated as same-order rather than as a guaranteed 39% CPU improvement.

## Real Docker VNC

The paired VNC comparison uses the same 1280x720, 10-second activity workload.

| Metric | Baseline | Optimized | Change |
| --- | ---: | ---: | ---: |
| First frame | 826 ms | 814 ms | -1.45% |
| Frames | 31 | 31 | unchanged |
| Full frames | 31 | 1 | -96.77% |
| Delta frames | 0 | 30 | native rectangle updates enabled |
| Frame payload | 97,517,568 B | 50,435,844 B | **-48.28%** |
| Payload bandwidth | 9.30 MiB/s | 4.81 MiB/s | **-48.28%** |
| Helper CPU | 5.77% | 4.99% | -13.52% |
| Max RSS | 14,384 KiB | 18,720 KiB | +4,336 KiB (+30.14%) |

The RSS increase is the framebuffer and pending keyframe/delta state used to avoid
repeated full-screen copies.

### Optimized VNC repeat runs

| Run | First frame | Frames | Full | Delta | Payload bytes | Wire bytes | MiB/s | CPU | Max RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 178 ms | 32 | 1 | 31 | 59,805,184 | 60,007,614 | 5.70 | 6.27% | 19,904 KiB |
| 2 | 312 ms | 38 | 1 | 37 | 66,136,320 | 66,361,842 | 6.31 | 5.00% | 18,736 KiB |
| 3 | 245 ms | 32 | 1 | 31 | 59,912,704 | 60,116,001 | 5.71 | 4.30% | 19,376 KiB |
| Average | 245 ms | 34 | 1 | 33 | 61,951,403 | 62,161,819 | 5.91 | 5.19% | 19,338.67 KiB |

## Reproduction

Build the helpers:

~~~sh
cargo +stable build --release \
  --manifest-path ../rdp-helper/Cargo.toml
cargo +stable build --release \
  --manifest-path ../vnc-helper/Cargo.toml
~~~

Run the real helper benchmark:

~~~sh
node benchmark-helper.mjs \
  --helper ../rdp-helper/target/release/navop-rdp-helper \
  --protocol rdp \
  --destination 127.0.0.1:13389 \
  --username navop \
  --password navop \
  --duration 10000
~~~

Run the deterministic RDP sparse-update benchmark:

~~~sh
cargo +stable test --release \
  --manifest-path ../rdp-helper/Cargo.toml \
  rdp::output::tests::benchmarks_sparse_frame_transport \
  -- --ignored --nocapture
~~~
