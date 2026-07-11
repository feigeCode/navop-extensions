# VNC Frame Memory Performance Design

**Date:** 2026-07-11
**Status:** Approved

## Problem

The VNC helper sends complete framebuffer snapshots through an unbounded
`std::sync::mpsc` channel. If framebuffer production is faster than stdout,
obsolete full frames accumulate in helper memory. The host mailbox and GPUI
texture lifecycle are already bounded for both RDP and VNC, so the remaining
unbounded stage is inside `vnc-helper`.

## Design

Add a blocking VNC output mailbox with a reliable FIFO control queue and one
replaceable latest-frame slot. `RemoteDesktopOutput::Frame` replaces only an
undisplayed frame. Connection, status, clipboard, cursor, failure, and
termination outputs remain ordered and reliable. Failure and termination clear
the pending frame before entering the control queue.

The stdout writer blocks on `recv`. Dropping the last sender wakes it and lets
it exit after reliable controls have drained. Dropping the receiver clears the
mailbox and makes future sends fail.

The VNC wire protocol and framebuffer patch/copy behavior remain unchanged.
The provider is released as `0.1.2`, and OnetCli requires VNC provider `0.1.2`
so the old unbounded helper cannot be opened silently.

## Bounds

- VNC helper: at most one frame being written plus one pending complete frame.
- OnetCli host: at most one pending complete frame through the shared mailbox.
- GPUI: current and previous rendered generations through the shared view.

## Verification

Tests cover latest-frame replacement, control ordering, terminal-frame
clearing, sender closure, receiver closure, VNC frame forwarding, provider
version rejection, and existing protocol compatibility. Final verification
includes helper tests, Clippy, release build, package verification, local
installation, OnetCli remote desktop tests/checks, formatting, and diff checks.
