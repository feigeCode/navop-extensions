// Docker volumes workbench page (embedded shell view).
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

export default class DockerVolumes extends View {
  init(_props, cx) {
    this.context = current();
    this.volumes = [];
    this.selected = null;
    this.detail = null;
    this.detailError = null;
    this.detailLoading = false;
    this.search = InputState.new({ value: "", placeholder: "Filter volumes" });
    this.newName = InputState.new({ value: "", placeholder: "volume name" });
    this.newDriver = InputState.new({ value: "local", placeholder: "driver" });
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
      const result = await dispatch("listVolumes");
      this.volumes = (result && result.volumes) || [];
      this.error = null;
      const stillThere = this.volumes.some((volume) => volume.name === this.selected);
      if (!stillThere) {
        this.selected = this.volumes.length > 0 ? this.volumes[0].name : null;
        this.detail = null;
      }
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
    if (this.selected) cx.spawn(async (cx) => this.loadDetail(cx));
  }

  selectedVolume() {
    return this.volumes.find((volume) => volume.name === this.selected) || null;
  }

  filteredVolumes() {
    const needle = this.search.value().trim().toLowerCase();
    if (!needle) return this.volumes;
    return this.volumes.filter((volume) =>
      [volume.name, volume.driver, volume.mountpoint].join(" ").toLowerCase().includes(needle));
  }

  async loadDetail(cx) {
    const target = this.selected;
    if (!target) return;
    this.detailLoading = true;
    this.detailError = null;
    cx.notify();
    try {
      const detail = await dispatch("volumeInspectByName", { name: target });
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

  select(name, cx) {
    if (this.selected === name) return;
    this.selected = name;
    this.detail = null;
    this.detailError = null;
    this.pendingRemove = null;
    cx.notify();
    cx.spawn(async (cx) => this.loadDetail(cx));
  }

  async createVolume(cx) {
    const name = this.newName.value().trim();
    const driver = this.newDriver.value().trim() || "local";
    if (!name) {
      this.error = "Volume name is required";
      cx.notify();
      return;
    }
    this.busy = true;
    cx.notify();
    try {
      await dispatch("volumeCreate", { name, driver }, { confirmed: true });
      this.notice = `Created volume ${name}`;
      this.error = null;
      this.showCreate = false;
      this.newName = InputState.new({ value: "", placeholder: "volume name" });
      this.selected = name;
      this.busy = false;
      await this.load(cx);
      return;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.busy = false;
    cx.notify();
  }

  async removeVolume(cx) {
    const target = this.pendingRemove;
    if (!target) return;
    this.busy = true;
    cx.notify();
    try {
      await dispatch("volumeRemoveByName", { name: target }, { confirmed: true });
      this.notice = `Removed volume ${target}`;
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
      const result = await dispatch("volumePrune", {}, { confirmed: true });
      const reclaimed = pick(result, "space_reclaimed", "SpaceReclaimed");
      this.notice = reclaimed ? `Pruned, reclaimed ${reclaimed}` : "Pruned unused volumes";
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
    if (this.loading && this.volumes.length === 0 && !this.error) return loadingView(cx, "Loading volumes…");
    if (this.error && this.volumes.length === 0) {
      return errorView(cx, "docker-volumes-retry", `Failed to list volumes: ${this.error}`,
        (cx) => this.load(cx));
    }
    const visible = this.filteredVolumes();
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
        ? [this.confirmBar(cx, "Remove all volumes not used by at least one container?",
          "Prune", "docker-volumes-prune-confirm", () => this.prune(cx),
          () => { this.pendingPrune = false; })]
        : [])
      .children(this.pendingRemove
        ? [this.confirmBar(cx, `Remove volume "${this.pendingRemove}"? Its data is deleted permanently.`,
          "Remove", "docker-volumes-remove-confirm", () => this.removeVolume(cx),
          () => { this.pendingRemove = null; })]
        : [])
      .child(h_flex().flex_1().min_h_0().min_w_0().items_stretch()
        .child(v_flex().w(280).flex_shrink_0().h_full().min_h_0().overflow_y_scrollbar()
          .border_r_1().border_color(cx.theme().colors.border)
          .children(visible.length === 0
            ? [div().p(12).text_size(12).text_color(cx.theme().colors.muted_foreground).child("No volumes match.")]
            : visible.map((volume) => this.listRow(cx, volume))))
        .child(v_flex().flex_1().min_w_0().h_full().min_h_0().overflow_y_scrollbar()
          .child(this.detailPane(cx))));
  }

  toolbar(cx) {
    return h_flex().px(12).py(10).gap(8).items_center().justify_between()
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(16).font_semibold().child("Volumes"))
        .child(new Badge().child(`${this.volumes.length} total`))
        .child(div().w(220).child(new Input(this.search))))
      .child(h_flex().gap(8)
        .child(new Button("docker-volumes-refresh").ghost().size("small").label("Refresh")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))))
        .child(new Button("docker-volumes-create").ghost().size("small")
          .label(this.showCreate ? "Cancel" : "Create volume")
          .on_click((_e, cx) => {
            this.showCreate = !this.showCreate;
            cx.notify();
          }))
        .child(new Button("docker-volumes-prune").ghost().size("small").label("Prune unused")
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
      .child(new Button("docker-volumes-create-apply").size("small")
        .label(this.busy ? "Creating…" : "Create")
        .on_click((_e, cx) => cx.spawn(async (cx) => {
          await this.createVolume(cx);
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

  listRow(cx, volume) {
    const isSelected = this.selected === volume.name;
    const refCount = Number(volume.ref_count);
    return v_flex().mx(6).my(2).px(8).py(6).gap(2).rounded(4)
      .bg(isSelected ? cx.theme().colors.secondary : cx.theme().colors.background)
      .on_click((_e, cx) => this.select(volume.name, cx))
      .child(h_flex().gap(6).items_center().min_w_0()
        .child(div().flex_1().min_w_0().text_size(12).text_ellipsis().child(text(volume.name)))
        .children(refCount > 0
          ? [new Badge().child(refCount === 1 ? "in use" : `in use ×${refCount}`)]
          : []))
      .child(div().text_size(11).text_color(cx.theme().colors.muted_foreground).text_ellipsis()
        .child(`${text(volume.driver)} · ${text(volume.size)}`));
  }

  detailPane(cx) {
    const volume = this.selectedVolume();
    if (!volume) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_color(cx.theme().colors.muted_foreground).child("Select a volume"));
    }
    const detail = this.detail || {};
    const labels = pick(detail, "Labels") || {};
    const labelEntries = Object.entries(labels);
    return v_flex().p(12).gap(10)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center().min_w_0()
          .child(div().text_size(15).font_semibold().text_ellipsis().child(text(volume.name)))
          .child(new Badge().child(text(volume.driver))))
        .child(new Button("docker-volumes-remove").size("small").label("Remove volume")
          .on_click((_e, cx) => {
            this.pendingRemove = volume.name;
            this.pendingPrune = false;
            cx.notify();
          })))

      .child(section(cx, "Overview", [
        kv(cx, "Name", pick(detail, "Name") || volume.name, { mono: true }),
        kv(cx, "Driver", pick(detail, "Driver") || volume.driver),
        kv(cx, "Scope", pick(detail, "Scope") || volume.scope),
        kv(cx, "Created", shortTime(pick(detail, "CreatedAt"))),
        kv(cx, "Size", volume.size),
        kv(cx, "References", Number(volume.ref_count) >= 0 ? volume.ref_count : "-"),
        kv(cx, "Mountpoint", pick(detail, "Mountpoint") || volume.mountpoint, { mono: true }),
      ]))

      .children(this.detailLoading
        ? [div().text_size(12).text_color(cx.theme().colors.muted_foreground).child("Loading details…")]
        : [])
      .children(this.detailError
        ? [div().text_size(12).text_color(cx.theme().colors.destructive)
          .child(`Details unavailable: ${this.detailError}`)]
        : [])

      .child(section(cx, "Labels", labelEntries.length === 0
        ? [kv(cx, "Labels", "none")]
        : labelEntries.map(([key, value]) => kv(cx, key, value, { mono: true }))));
  }
}
