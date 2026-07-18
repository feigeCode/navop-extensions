# Remote desktop helper benchmark

`benchmark-helper.mjs` drives a provider helper through its stdin/stdout protocol and records
first-frame latency, frame counts, full-vs-delta frames, payload bandwidth, helper CPU, and RSS.
The benchmark uses a fixed 1280x720 session and sends pointer/wheel activity every 33 ms.

The Docker servers used for the July 2026 run were:

- RDP: `docker.1ms.run/danielguerra/ubuntu-xrdp:latest` on `127.0.0.1:13389`.
- VNC: `docker.m.daocloud.io/dorowu/ubuntu-desktop-lxde-vnc:latest` on `127.0.0.1:15900`.

Both images are amd64 and therefore run through Docker Desktop Rosetta on Apple Silicon. RDP
handshake reached the xrdp session but the IronRDP test client rejected an xrdp Fast-Path PDU;
that result is recorded as a server compatibility failure, not as an FPS claim.

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

The RDP helper currently uses the sibling `ironrdp-filecopy` worktree because the
file-copy input event is an unreleased IronRDP client API. Build the three worktrees
together, or replace those path dependencies with the published IronRDP patch before
building outside this workspace.
