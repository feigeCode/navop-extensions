// Docker networks workbench page (embedded shell view).
//
// Master-detail list with an inline create form. See images.js for why every
// call targets an input-bound operation instead of the selection-bound one.

import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Badge, Button, Input } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import {
  errorMessage, errorView, kv, loadingView, pick, section, shortTime, text,
} from "./shared.js";

/** A network can never be removed while containers are still attached. */
function attachedContainers(detail) {
  const containers = pick(detail, "Containers");
  if (!containers || typeof containers !== "object") return [];
  return Object.entries(containers).map(([id, info]) => ({
    id,
    name: text(pick(info, "Name"), id.slice(0, 12)),
    address: pick(info, "IPv4Address"),
  }));
}

function subnets(detail) {
  const ipam = pick(detail, "IPAM");
  const configs = pick(ipam, "Config");
  if (!Array.isArray(configs)) return [];
  return configs.map((entry) =>
    `${text(pick(entry, "Subnet"))}${pick(entry, "Gateway") ? ` via ${pick(entry, "Gateway")}` : ""}`);
}

export default class DockerNetworks extends View {
  init(_props, cx) {
    this.context = current();
    this.networks = [];
    this.selected = null;
    this.detail = null;
    this.detailError = null;
    this.detailLoading = false;
    this.search = InputState.new({ value: "", placeholder: "Filter networks" });
    this.newName = InputState.new({ value: "", placeholder: "network name" });
    this.newDriver = InputState.new({ value: "bridge", placeholder: "driver" });
    this.showCreate = false;
    this.pendingRemove = null;
    this.pendingPrune = false;
    this.busy = false;
    this.error = null;
    this.notice = null;
    this.loading = true;
    cx.spawn(async (cx) => this.load(cx));
  }

  async load(cx) {
    this.loading = true;
    cx.notify();
    try {
      const result = await dispatch("listNetworks");
      this.networks = (result && result.networks) || [];
      this.error = null;
      const stillThere = this.networks.some((network) => network.id === this.selected);
      if (!stillThere) {
        this.selected = this.networks.length > 0 ? this.networks[0].id : null;
        this.detail = null;
      }
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
    if (this.selected) cx.spawn(async (cx) => this.loadDetail(cx));
  }

  selectedNetwork() {
    return this.networks.find((network) => network.id === this.selected) || null;
  }

  filteredNetworks() {
    const needle = this.search.value().trim().toLowerCase();
    if (!needle) return this.networks;
    return this.networks.filter((network) =>
      [network.name, network.id, network.driver].join(" ").toLowerCase().includes(needle));
  }

  async loadDetail(cx) {
    const target = this.selected;
    if (!target) return;
    this.detailLoading = true;
    this.detailError = null;
    cx.notify();
    try {
      const detail = await dispatch("networkInspectById", { id: target });
      if (this.selected !== target) return;
      this.detail = detail || null;
    } catch (error) {
      if (this.selected !== target) return;
      this.detail = null;
      this.detailError = errorMessage(error);
    }
    this.detailLoading = false;
    cx.notify();
  }

  select(id, cx) {
    if (this.selected === id) return;
    this.selected = id;
    this.detail = null;
    this.detailError = null;
    this.pendingRemove = null;
    cx.notify();
    cx.spawn(async (cx) => this.loadDetail(cx));
  }

  async createNetwork(cx) {
    const name = this.newName.value().trim();
    const driver = this.newDriver.value().trim() || "bridge";
    if (!name) {
      this.error = "Network name is required";
      cx.notify();
      return;
    }
    this.busy = true;
    cx.notify();
    try {
      await dispatch("networkCreate", { name, driver }, { confirmed: true });
      this.notice = `Created network ${name}`;
      this.error = null;
      this.showCreate = false;
      this.newName = InputState.new({ value: "", placeholder: "network name" });
      this.busy = false;
      await this.load(cx);
      return;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.busy = false;
    cx.notify();
  }

  async removeNetwork(cx) {
    const target = this.pendingRemove;
    if (!target) return;
    this.busy = true;
    cx.notify();
    try {
      await dispatch("networkRemoveById", { id: target }, { confirmed: true });
      this.notice = `Removed network ${target}`;
      this.error = null;
      this.pendingRemove = null;
      if (this.selected === target) {
        this.selected = null;
        this.detail = null;
      }
      this.busy = false;
      await this.load(cx);
      return;
    } catch (error) {
      this.error = errorMessage(error);
      this.pendingRemove = null;
    }
    this.busy = false;
    cx.notify();
  }

  async prune(cx) {
    this.busy = true;
    cx.notify();
    try {
      await dispatch("networkPrune", {}, { confirmed: true });
      this.notice = "Pruned unused networks";
      this.error = null;
      this.pendingPrune = false;
      this.busy = false;
      await this.load(cx);
      return;
    } catch (error) {
      this.error = errorMessage(error);
      this.pendingPrune = false;
    }
    this.busy = false;
    cx.notify();
  }

  render(cx) {
    if (this.loading && this.networks.length === 0 && !this.error) return loadingView(cx, "Loading networks…");
    if (this.error && this.networks.length === 0) {
      return errorView(cx, "docker-networks-retry", `Failed to list networks: ${this.error}`,
        (cx) => this.load(cx));
    }
    const visible = this.filteredNetworks();
    return v_flex().size_full().min_h_0().min_w_0()
      .child(this.toolbar(cx))
      .children(this.showCreate ? [this.createForm(cx)] : [])
      .children(this.error
        ? [div().px(12).pb(6).text_size(12).text_color(cx.theme().colors.destructive).child(this.error)]
        : [])
      .children(this.notice
        ? [div().px(12).pb(6).text_size(12).text_color(cx.theme().colors.muted_foreground).child(this.notice)]
        : [])
      .children(this.pendingPrune
        ? [this.confirmBar(cx, "Remove all unused networks? Containers using a removed network lose connectivity.",
          "Prune", "docker-networks-prune-confirm", () => this.prune(cx),
          () => { this.pendingPrune = false; })]
        : [])
      .children(this.pendingRemove
        ? [this.confirmBar(cx, `Remove network "${this.pendingRemove}"? Containers must be disconnected first.`,
          "Remove", "docker-networks-remove-confirm", () => this.removeNetwork(cx),
          () => { this.pendingRemove = null; })]
        : [])
      .child(h_flex().flex_1().min_h_0().min_w_0().items_stretch()
        .child(v_flex().w(280).flex_shrink_0().h_full().min_h_0().overflow_y_scrollbar()
          .border_r_1().border_color(cx.theme().colors.border)
          .children(visible.length === 0
            ? [div().p(12).text_size(12).text_color(cx.theme().colors.muted_foreground).child("No networks match.")]
            : visible.map((network) => this.listRow(cx, network))))
        .child(v_flex().flex_1().min_w_0().h_full().min_h_0().overflow_y_scrollbar()
          .child(this.detailPane(cx))));
  }

  toolbar(cx) {
    return h_flex().px(12).py(10).gap(8).items_center().justify_between()
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(16).font_semibold().child("Networks"))
        .child(new Badge().child(`${this.networks.length} total`))
        .child(div().w(220).child(new Input(this.search))))
      .child(h_flex().gap(8)
        .child(new Button("docker-networks-refresh").ghost().size("small").label("Refresh")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))))
        .child(new Button("docker-networks-create").ghost().size("small")
          .label(this.showCreate ? "Cancel" : "Create network")
          .on_click((_e, cx) => {
            this.showCreate = !this.showCreate;
            cx.notify();
          }))
        .child(new Button("docker-networks-prune").ghost().size("small").label("Prune unused")
          .on_click((_e, cx) => {
            this.pendingPrune = true;
            this.pendingRemove = null;
            cx.notify();
          })));
  }

  createForm(cx) {
    return h_flex().mx(12).mb(8).px(10).py(8).gap(6).items_center()
      .border_1().border_color(cx.theme().colors.border).rounded(6)
      .child(div().w(220).flex_shrink_0().child(new Input(this.newName)))
      .child(div().w(120).flex_shrink_0().child(new Input(this.newDriver)))
      .child(new Button("docker-networks-create-apply").size("small")
        .label(this.busy ? "Creating…" : "Create")
        .on_click((_e, cx) => cx.spawn(async (cx) => {
          await this.createNetwork(cx);
          cx.notify();
        })));
  }

  confirmBar(cx, message, actionLabel, actionId, onConfirm, onCancel) {
    return h_flex().mx(12).mb(6).px(10).py(8).gap(8).items_center()
      .border_1().border_color(cx.theme().colors.destructive).rounded(6)
      .child(div().flex_1().min_w_0().text_size(12).child(message))
      .child(new Button(`${actionId}-cancel`).ghost().size("small").label("Cancel")
        .on_click((_e, cx) => {
          onCancel();
          cx.notify();
        }))
      .child(new Button(actionId).size("small").label(this.busy ? "Working…" : actionLabel)
        .on_click((_e, cx) => cx.spawn(async (cx) => {
          await onConfirm();
          cx.notify();
        })));
  }

  listRow(cx, network) {
    const isSelected = this.selected === network.id;
    return v_flex().mx(6).my(2).px(8).py(6).gap(2).rounded(4)
      .bg(isSelected ? cx.theme().colors.secondary : cx.theme().colors.background)
      .on_click((_e, cx) => this.select(network.id, cx))
      .child(h_flex().gap(6).items_center().min_w_0()
        .child(div().flex_1().min_w_0().text_size(12).text_ellipsis().child(text(network.name)))
        .children(network.internal
          ? [new Badge().color(cx.theme().colors.accent).child("internal")]
          : []))
      .child(div().text_size(11).text_color(cx.theme().colors.muted_foreground).text_ellipsis()
        .child(`${text(network.driver)} · ${text(network.scope)} · ${text(network.id)}`));
  }

  detailPane(cx) {
    const network = this.selectedNetwork();
    if (!network) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_color(cx.theme().colors.muted_foreground).child("Select a network"));
    }
    const detail = this.detail || {};
    const attached = attachedContainers(detail);
    const labelEntries = Object.entries(pick(detail, "Labels") || {});
    const optionEntries = Object.entries(pick(detail, "Options") || {});
    return v_flex().p(12).gap(10)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center().min_w_0()
          .child(div().text_size(15).font_semibold().text_ellipsis().child(text(network.name)))
          .child(new Badge().child(text(network.driver)))
          .children(network.internal ? [new Badge().child("internal")] : []))
        .child(new Button("docker-networks-remove").size("small").label("Remove network")
          .on_click((_e, cx) => {
            this.pendingRemove = network.id;
            this.pendingPrune = false;
            cx.notify();
          })))

      .children(attached.length > 0
        ? [div().text_size(12).text_color(cx.theme().colors.muted_foreground)
          .child(`${attached.length} container${attached.length === 1 ? "" : "s"} attached — disconnect them before removing.`)]
        : [])

      .child(section(cx, "Overview", [
        kv(cx, "Name", pick(detail, "Name") || network.name, { mono: true }),
        kv(cx, "ID", pick(detail, "Id") || network.id, { mono: true }),
        kv(cx, "Driver", pick(detail, "Driver") || network.driver),
        kv(cx, "Scope", pick(detail, "Scope") || network.scope),
        kv(cx, "Internal", pick(detail, "Internal")),
        kv(cx, "Created", shortTime(pick(detail, "Created"))),
      ]))

      .children(this.detailLoading
        ? [div().text_size(12).text_color(cx.theme().colors.muted_foreground).child("Loading details…")]
        : [])
      .children(this.detailError
        ? [div().text_size(12).text_color(cx.theme().colors.destructive)
          .child(`Details unavailable: ${this.detailError}`)]
        : [])

      .child(section(cx, "IPAM", (() => {
        const entries = subnets(detail);
        return entries.length === 0
          ? [kv(cx, "Subnets", "none")]
          : entries.map((entry, index) => kv(cx, `Subnet ${index + 1}`, entry, { mono: true }));
      })()))

      .child(section(cx, "Attached containers", attached.length === 0
        ? [kv(cx, "Containers", "none")]
        : attached.map((entry) => kv(cx, entry.name, `${entry.id.slice(0, 12)} ${entry.address ? `· ${entry.address}` : ""}`, { mono: true }))))

      .child(section(cx, "Configuration", [
        ...(labelEntries.length === 0 ? [kv(cx, "Labels", "none")] : labelEntries.map(([key, value]) => kv(cx, key, value, { mono: true }))),
        ...(optionEntries.length === 0 ? [kv(cx, "Options", "defaults")] : optionEntries.map(([key, value]) => kv(cx, key, value, { mono: true }))),
      ]));
  }
}
