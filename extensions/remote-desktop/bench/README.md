# Remote desktop helper benchmark

`benchmark-helper.mjs` drives a provider helper through its stdin/stdout protocol and records
first-frame latency, frame counts, full-vs-delta frames, payload bandwidth, helper CPU, and RSS.
The benchmark uses a fixed 1280x720 session and sends pointer/wheel activity every 33 ms.

Measured baseline and optimized results are recorded in [RESULTS.md](RESULTS.md).

The Docker servers used for the July 2026 run were:

- RDP: `docker.1ms.run/danielguerra/ubuntu-xrdp:latest` on `127.0.0.1:13389`.
- VNC: `docker.m.daocloud.io/dorowu/ubuntu-desktop-lxde-vnc:latest` on `127.0.0.1:15900`.

Both images are amd64 and therefore run through Docker Desktop Rosetta on Apple Silicon. The
RDP helper disables the unused rdpsnd channel, which avoids xrdp audio PDUs that older IronRDP
clients could not decode, so the Docker RDP benchmark reaches the first frame.

Example invocation:

```sh
node benchmark-helper.mjs \
  --helper ../rdp-helper/target/release/onetcli-rdp-helper \
  --protocol rdp --destination 127.0.0.1:13389 \
  --username navop --password navop --duration 10000
```

For deterministic provider-side RDP transport measurements, run the ignored release test:

```sh
cargo +stable test --release --manifest-path ../rdp-helper/Cargo.toml \
  rdp::output::tests::benchmarks_sparse_frame_transport -- --ignored --nocapture
```

The RDP helper uses the feigeCode/IronRDP fork at revision 5f4b61a because the
file-copy input event and the audio-channel compatibility fix are not in the upstream
release yet.
