// Docker container inspect page (embedded shell view).
//
// Source: `inspectContainer` (docker/container/inspect), which returns the raw
// Docker inspect document. We distill it here instead of in the provider so the
// provider contract stays the untouched Docker payload.

import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Badge, Button } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import {
  errorMessage, errorView, humanBytes, kv, loadingView, pick, section, shortTime,
  stateColor, text,
} from "./shared.js";

/** `{"80/tcp": [{HostIp, HostPort}]}` -> `0.0.0.0:8080 -> 80/tcp`. */
function formatPorts(ports) {
  if (!ports || typeof ports !== "object") return [];
  const lines = [];
  for (const [containerPort, bindings] of Object.entries(ports)) {
    if (!Array.isArray(bindings) || bindings.length === 0) {
      lines.push(`${containerPort} (exposed)`);
      continue;
    }
    for (const binding of bindings) {
      const ip = pick(binding, "HostIp") || "0.0.0.0";
      lines.push(`${ip}:${text(pick(binding, "HostPort"))} -> ${containerPort}`);
    }
  }
  return lines;
}

/** Memory-style limits: 0 (or absent) means the daemon applies no limit. */
function limitText(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "unlimited";
  return humanBytes(n);
}

function policyText(policy) {
  const name = pick(policy, "Name");
  if (!name || name === "no") return "no";
  const retries = pick(policy, "MaximumRetryCount");
  return retries ? `${name} (max ${retries})` : String(name);
}

function monotoneBlock(cx, title, lines) {
  return v_flex().gap(6).border_1().border_color(cx.theme().colors.border).rounded(6).p(12)
    .child(div().font_semibold().child(title))
    .child(v_flex().gap(2).children(lines.map((line) =>
      div().font_family("monospace").text_size(11).child(line))));
}

function networkRows(cx, network) {
  const rows = [
    kv(cx, "IP address", pick(network, "IPAddress"), { mono: true }),
    kv(cx, "Gateway", pick(network, "Gateway"), { mono: true }),
    kv(cx, "MAC address", pick(network, "MacAddress"), { mono: true }),
    kv(cx, "Hostname", pick(network, "Hostname")),
  ];
  const ports = formatPorts(pick(network, "Ports"));
  rows.push(kv(cx, "Ports", ports.length > 0 ? ports.join(", ") : "none", { mono: true }));
  const networks = pick(network, "Networks");
  if (networks && typeof networks === "object") {
    for (const [name, value] of Object.entries(networks)) {
      rows.push(kv(
        cx,
        `Network ${name}`,
        `${text(pick(value, "IPAddress"))} gw ${text(pick(value, "Gateway"))}`,
        { mono: true },
      ));
    }
  }
  return rows;
}

function mountRows(cx, mounts) {
  if (!Array.isArray(mounts) || mounts.length === 0) return [kv(cx, "Mounts", "none")];
  return mounts.map((mount, index) => {
    const access = pick(mount, "RW") === false ? "ro" : "rw";
    const mode = text(pick(mount, "Mode"), "");
    return kv(
      cx,
      `${text(pick(mount, "Type"))} ${index + 1}`,
      `${text(pick(mount, "Source"))} -> ${text(pick(mount, "Destination"))} (${mode ? `${mode}, ` : ""}${access})`,
      { mono: true },
    );
  });
}

export default class DockerContainerInspect extends View {
  init(_props, cx) {
    this.context = current();
    this.data = null;
    this.error = null;
    this.loading = true;
    cx.spawn(async (cx) => this.load(cx));
  }

  containerId() {
    const route = this.context && this.context.route;
    return (route && route.id) || "";
  }

  async load(cx) {
    this.loading = true;
    cx.notify();
    try {
      this.data = await dispatch("inspectContainer");
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
  }

  render(cx) {
    if (this.loading && !this.data && !this.error) return loadingView(cx, "Loading container…");
    if (this.error) {
      return errorView(cx, "docker-inspect-retry", `Failed to inspect: ${this.error}`,
        (cx) => this.load(cx));
    }
    const data = this.data || {};
    const state = pick(data, "State") || {};
    const config = pick(data, "Config") || {};
    const host = pick(data, "HostConfig") || {};
    const network = pick(data, "NetworkSettings") || {};
    const status = text(pick(state, "Status"));
    const health = pick(state, "Health");
    const rawName = text(pick(data, "Name"), "");
    const name = rawName.replace(/^\//, "") || this.containerId();
    const cmd = pick(config, "Cmd");
    const env = pick(config, "Env");
    const labels = pick(config, "Labels");

    return v_flex().size_full().min_h_0().min_w_0().overflow_y_scrollbar().p(16).gap(12)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center().min_w_0()
          .child(div().text_size(16).font_semibold().text_ellipsis().child(name))
          .child(new Badge().color(stateColor(cx, status)).child(status))
          .children(health
            ? [new Badge().color(stateColor(cx, text(pick(health, "Status"))))
              .child(`health: ${text(pick(health, "Status"))}`)]
            : []))
        .child(new Button("docker-inspect-refresh").ghost().label("Refresh")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)))))

      .child(section(cx, "Overview", [
        kv(cx, "Container ID", pick(data, "Id"), { mono: true }),
        kv(cx, "Image", pick(config, "Image"), { mono: true }),
        kv(cx, "Image ID", pick(data, "Image"), { mono: true }),
        kv(cx, "Command", Array.isArray(cmd) ? cmd.join(" ") : cmd, { mono: true }),
        kv(cx, "Entrypoint", pick(config, "Entrypoint"), { mono: true }),
        kv(cx, "Created", shortTime(pick(data, "Created"))),
        kv(cx, "Platform", pick(data, "Platform")),
        kv(cx, "Restart count", pick(data, "RestartCount")),
        kv(cx, "Working dir", pick(config, "WorkingDir"), { mono: true }),
      ]))

      .child(section(cx, "State", [
        kv(cx, "Status", pick(state, "Status")),
        kv(cx, "Running", pick(state, "Running")),
        kv(cx, "Paused", pick(state, "Paused")),
        kv(cx, "Restarting", pick(state, "Restarting")),
        kv(cx, "OOM killed", pick(state, "OOMKilled")),
        kv(cx, "Exit code", pick(state, "ExitCode")),
        kv(cx, "Pid", pick(state, "Pid")),
        kv(cx, "Error", pick(state, "Error")),
        kv(cx, "Started at", shortTime(pick(state, "StartedAt"))),
        kv(cx, "Finished at", shortTime(pick(state, "FinishedAt"))),
      ]))

      .child(section(cx, "Resources", [
        kv(cx, "Memory limit", limitText(pick(host, "Memory"))),
        kv(cx, "Memory swap", limitText(pick(host, "MemorySwap"))),
        kv(cx, "CPU shares", pick(host, "CpuShares")),
        kv(cx, "NanoCPUs", pick(host, "NanoCpus")),
        kv(cx, "Pids limit", pick(host, "PidsLimit")),
        kv(cx, "Restart policy", policyText(pick(host, "RestartPolicy"))),
      ]))

      .child(section(cx, "Network", networkRows(cx, network)))
      .child(section(cx, "Mounts", mountRows(cx, pick(data, "Mounts"))))

      .children(Array.isArray(env) && env.length > 0
        ? [monotoneBlock(cx, `Environment (${env.length})`, env.map((entry) => String(entry)))]
        : [])

      .children(labels && typeof labels === "object" && Object.keys(labels).length > 0
        ? [monotoneBlock(cx, `Labels (${Object.keys(labels).length})`,
          Object.entries(labels).map(([key, value]) => `${key}=${value}`))]
        : []);
  }
}
