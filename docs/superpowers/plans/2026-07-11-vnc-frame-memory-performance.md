# VNC Frame Memory Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound complete framebuffer retention inside the VNC helper and require the corrected provider version.

**Architecture:** Replace the VNC helper's unbounded output channel with a blocking mailbox containing a reliable control queue and one latest-frame slot. Keep the existing helper protocol and shared host/view pipeline unchanged.

**Tech Stack:** Rust, `Mutex`, `Condvar`, VNC helper JSON-header/binary-frame protocol, Cargo tests and packaging scripts.

---

### Task 1: Add The VNC Output Mailbox

**Files:**
- Create: `extensions/remote-desktop/vnc-helper/src/output_mailbox.rs`
- Modify: `extensions/remote-desktop/vnc-helper/src/main.rs`

- [ ] Write tests proving latest-frame replacement, control ordering, terminal clearing, last-sender wakeup, and receiver closure.
- [ ] Run the focused tests and confirm they fail because the mailbox API is absent.
- [ ] Implement the blocking mailbox and change the stdout writer to `while let Some(output) = output_rx.recv()`.
- [ ] Run the mailbox tests and confirm they pass.

### Task 2: Integrate Every VNC Output Producer

**Files:**
- Modify: `extensions/remote-desktop/vnc-helper/src/vnc_encoding.rs`
- Modify: `extensions/remote-desktop/vnc-helper/src/vnc_input.rs`
- Modify: `extensions/remote-desktop/vnc-helper/src/vnc_rfb.rs`

- [ ] Add a failing burst-frame integration test using the wished-for mailbox sender.
- [ ] Replace `std::sync::mpsc::Sender<RemoteDesktopOutput>` with `OutputSender` throughout the helper.
- [ ] Preserve framebuffer patch/copy, clipboard, status, reconnect, and terminal behavior.
- [ ] Run the full VNC helper test suite and strict Clippy.

### Task 3: Release And Require VNC Provider 0.1.2

**Files:**
- Modify: `extensions/remote-desktop/vnc-helper/Cargo.toml`
- Modify: `extensions/remote-desktop/vnc-helper/Cargo.lock`
- Modify: `extensions/remote-desktop/vnc/remote_desktop_provider.json`
- Modify: `manifest.json`
- Modify in `onetcli`: `crates/remote_desktop/src/backend.rs`

- [ ] Add a failing OnetCli test proving VNC provider `0.1.1` is rejected in favor of `0.1.2`.
- [ ] Bump helper/provider metadata and the OnetCli minimum version.
- [ ] Run formatting, helper tests/Clippy, OnetCli remote desktop tests/checks, release build, package verifier, and diff checks.
- [ ] Review the complete diff, commit each repository, and install VNC locally.
