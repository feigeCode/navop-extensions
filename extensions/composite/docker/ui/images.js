// Docker images workbench page (embedded shell view).
//
// Master-detail replacement for the old native image table: filterable list on
// the left, distilled inspect of the selection on the right, inline confirm for
// destructive actions.
//
// A shell page gets no `selection` binding (that comes from the native page
// context), so every call here targets the `*ByRef` operations whose params are
// read from `input`. Destructive effects must pass `{ confirmed: true }`.

import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Badge, Button, DataTable, DataTableState, Input } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import {
  errorMessage, errorView, humanBytes, kv, loadingView, pick, section, shortTime, text,
} from "./shared.js";

const HISTORY_TITLES = ["Created", "Size", "Created by"];

/** Entrypoint/Cmd arrive as an array; join with spaces the way the CLI prints them. */
function joinCommand(value) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(" ") : "-";
  if (typeof value === "string" && value.length > 0) return value;
  return "-";
}

/** `ghcr.io/acme/api:1.4` -> repo + tag, keeping a registry port out of the tag. */
function splitImageRef(reference) {
  const index = reference.lastIndexOf(":");
  if (index > 0 && !reference.slice(index + 1).includes("/")) {
    return { image: reference.slice(0, index), tag: reference.slice(index + 1) || "latest" };
  }
  return { image: reference, tag: "latest" };
}

export default class DockerImages extends View {
  init(_props, cx) {
    this.context = current();
    this.images = [];
    this.selected = null;
    this.detail = null;
    this.history = null;
    this.detailError = null;
    this.detailLoading = false;
    this.tab = "info";
    this.search = InputState.new({ value: "", placeholder: "Filter images" });
    this.tagRepo = InputState.new({ value: "", placeholder: "repo/name" });
    this.tagName = InputState.new({ value: "", placeholder: "tag" });
    this.pullRef = InputState.new({ value: "", placeholder: "repo/name:tag" });
    this.showTagForm = false;
    this.showPull = false;
    this.pulling = false;
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
      const result = await dispatch("listImages");
      this.images = (result && result.images) || [];
      this.error = null;
      const stillThere = this.images.some((image) => image.remove_target === this.selected);
      if (!stillThere) {
        this.selected = this.images.length > 0 ? this.images[0].remove_target : null;
        this.detail = null;
        this.history = null;
      }
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
    if (this.selected) cx.spawn(async (cx) => this.loadDetail(cx));
  }

  selectedImage() {
    return this.images.find((image) => image.remove_target === this.selected) || null;
  }

  filteredImages() {
    const needle = this.search.value().trim().toLowerCase();
    if (!needle) return this.images;
    return this.images.filter((image) => {
      const haystack = [image.name, image.id, ...(image.tags || [])].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }

  async loadDetail(cx) {
    const target = this.selected;
    if (!target) return;
    this.detailLoading = true;
    this.detailError = null;
    cx.notify();
    try {
      const [detail, history] = await Promise.all([
        dispatch("imageInspectByRef", { name: target }),
        dispatch("imageHistoryByRef", { name: target }),
      ]);
      if (this.selected !== target) return;
      this.detail = detail || null;
      this.history = (history && (history.history || history)) || null;
    } catch (error) {
      if (this.selected !== target) return;
      this.detail = null;
      this.history = null;
      this.detailError = errorMessage(error);
    }
    this.detailLoading = false;
    cx.notify();
  }

  select(target, cx) {
    if (this.selected === target) return;
    this.selected = target;
    this.detail = null;
    this.history = null;
    this.detailError = null;
    this.showTagForm = false;
    this.pendingRemove = null;
    cx.notify();
    cx.spawn(async (cx) => this.loadDetail(cx));
  }

  async removeImage(cx) {
    const target = this.pendingRemove;
    if (!target) return;
    this.busy = true;
    cx.notify();
    try {
      await dispatch("imageRemoveByRef", { name: target }, { confirmed: true });
      this.notice = `Removed ${target}`;
      this.error = null;
      this.pendingRemove = null;
      if (this.selected === target) {
        this.selected = null;
        this.detail = null;
        this.history = null;
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
      const result = await dispatch("imagePrune", { all: false }, { confirmed: true });
      const reclaimed = pick(result, "space_reclaimed", "SpaceReclaimed");
      this.notice = reclaimed ? `Pruned, reclaimed ${humanBytes(reclaimed)}` : "Pruned unused images";
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

  async applyTag(cx) {
    const repo = this.tagRepo.value().trim();
    const tag = this.tagName.value().trim();
    if (!this.selected || !repo) return;
    this.busy = true;
    cx.notify();
    try {
      await dispatch("imageTagByRef", {
        name: this.selected,
        repo,
        tag: tag || "latest",
      }, { confirmed: true });
      this.notice = `Tagged as ${repo}:${tag || "latest"}`;
      this.error = null;
      this.showTagForm = false;
      this.tagRepo = InputState.new({ value: "", placeholder: "repo/name" });
      this.tagName = InputState.new({ value: "", placeholder: "tag" });
      this.busy = false;
      await this.load(cx);
      return;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.busy = false;
    cx.notify();
  }

  async pullImage(cx) {
    const reference = this.pullRef.value().trim();
    if (!reference) {
      this.error = "Image reference is required";
      cx.notify();
      return;
    }
    // `docker pull` is a job operation: the host polls it to a terminal state
    // before `dispatch` resolves, so a cold cache can keep this busy a while.
    const { image, tag } = splitImageRef(reference);
    this.pulling = true;
    this.error = null;
    this.notice = `Pulling ${reference}…`;
    cx.notify();
    try {
      await dispatch("pullImage", { image, tag }, { confirmed: true });
      this.notice = `Pulled ${reference}`;
      this.error = null;
      this.showPull = false;
      this.pullRef = InputState.new({ value: "", placeholder: "repo/name:tag" });
      this.pulling = false;
      await this.load(cx);
      return;
    } catch (error) {
      this.error = errorMessage(error);
      this.notice = null;
    }
    this.pulling = false;
    cx.notify();
  }

  historyRows() {
    const entries = Array.isArray(this.history) ? this.history : [];
    return entries.map((entry) => [
      shortTime(pick(entry, "Created", "created")),
      humanBytes(pick(entry, "Size", "size")),
      text(pick(entry, "CreatedBy", "created_by")),
    ]);
  }

  render(cx) {
    if (this.loading && this.images.length === 0 && !this.error) return loadingView(cx, "Loading images…");
    if (this.error && this.images.length === 0) {
      return errorView(cx, "docker-images-retry", `Failed to list images: ${this.error}`,
        (cx) => this.load(cx));
    }
    const visible = this.filteredImages();
    return v_flex().size_full().min_h_0().min_w_0()
      .child(this.toolbar(cx))
      .children(this.showPull ? [this.pullForm(cx)] : [])
      .children(this.error
        ? [div().px(12).pb(6).text_size(12).text_color(cx.theme().colors.destructive).child(this.error)]
        : [])
      .children(this.notice
        ? [div().px(12).pb(6).text_size(12).text_color(cx.theme().colors.muted_foreground).child(this.notice)]
        : [])
      .children(this.pendingPrune
        ? [this.confirmBar(cx, "Prune all dangling images and unused layers?",
          "Prune", "docker-images-prune-confirm", () => this.prune(cx),
          () => { this.pendingPrune = false; })]
        : [])
      .children(this.pendingRemove
        ? [this.confirmBar(cx, `Remove image "${this.pendingRemove}"? This cannot be undone.`,
          "Remove", "docker-images-remove-confirm", () => this.removeImage(cx),
          () => { this.pendingRemove = null; })]
        : [])
      .child(h_flex().flex_1().min_h_0().min_w_0().items_stretch()
        .child(v_flex().w(280).flex_shrink_0().h_full().min_h_0().overflow_y_scrollbar()
          .border_r_1().border_color(cx.theme().colors.border)
          .children(visible.length === 0
            ? [div().p(12).text_size(12).text_color(cx.theme().colors.muted_foreground).child("No images match.")]
            : visible.map((image) => this.listRow(cx, image))))
        .child(v_flex().flex_1().min_w_0().h_full().min_h_0().overflow_y_scrollbar()
          .child(this.detailPane(cx))));
  }

  toolbar(cx) {
    return h_flex().px(12).py(10).gap(8).items_center().justify_between()
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(16).font_semibold().child("Images"))
        .child(new Badge().child(`${this.images.length} local`))
        .child(div().w(220).child(new Input(this.search))))
      .child(h_flex().gap(8)
        .child(new Button("docker-images-refresh").ghost().size("small").label("Refresh")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))))
        .child(new Button("docker-images-pull").ghost().size("small")
          .label(this.showPull ? "Cancel" : "Pull image")
          .on_click((_e, cx) => {
            this.showPull = !this.showPull;
            cx.notify();
          }))
        .child(new Button("docker-images-prune").ghost().size("small").label("Prune unused")
          .on_click((_e, cx) => {
            this.pendingPrune = true;
            this.pendingRemove = null;
            cx.notify();
          })));
  }

  pullForm(cx) {
    return h_flex().mx(12).mb(8).px(10).py(8).gap(6).items_center()
      .border_1().border_color(cx.theme().colors.border).rounded(6)
      .child(div().w(320).flex_shrink_0().child(new Input(this.pullRef)))
      .child(new Button("docker-images-pull-apply").size("small")
        .label(this.pulling ? "Pulling…" : "Pull")
        .on_click((_e, cx) => cx.spawn(async (cx) => {
          await this.pullImage(cx);
          cx.notify();
        })))
      .children(this.pulling
        ? [div().text_size(11).text_color(cx.theme().colors.muted_foreground)
          .child("Large images can take minutes on a cold cache.")]
        : []);
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

  listRow(cx, image) {
    const isSelected = this.selected === image.remove_target;
    const tagCount = Number(image.tag_count) || 0;
    return v_flex().mx(6).my(2).px(8).py(6).gap(2).rounded(4)
      .bg(isSelected ? cx.theme().colors.secondary : cx.theme().colors.background)
      .on_click((_e, cx) => this.select(image.remove_target, cx))
      .child(h_flex().gap(6).items_center().min_w_0()
        .child(div().flex_1().min_w_0().text_size(12).text_ellipsis().child(text(image.name)))
        .children(image.dangling
          ? [new Badge().color(cx.theme().colors.destructive).child("dangling")]
          : []))
      .child(div().text_size(11).text_color(cx.theme().colors.muted_foreground).text_ellipsis()
        .child(`${tagCount} tag${tagCount === 1 ? "" : "s"} · ${text(image.size)} · ${text(image.created)}`));
  }

  detailPane(cx) {
    const image = this.selectedImage();
    if (!image) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_color(cx.theme().colors.muted_foreground).child("Select an image"));
    }
    const detail = this.detail || {};
    const config = pick(detail, "Config") || {};
    const env = pick(config, "Env");
    const tags = Array.isArray(image.tags) && image.tags.length > 0 ? image.tags.join(", ") : "<none>";
    return v_flex().p(12).gap(10)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center().min_w_0()
          .child(div().text_size(15).font_semibold().text_ellipsis().child(text(image.name)))
          .children(image.dangling ? [new Badge().child("untagged")] : []))
        .child(h_flex().gap(6)
          .child(new Button("docker-images-tag-toggle").ghost().size("small")
            .label(this.showTagForm ? "Cancel tag" : "Add tag")
            .on_click((_e, cx) => {
              this.showTagForm = !this.showTagForm;
              cx.notify();
            }))
          .child(new Button("docker-images-remove").size("small").label("Remove image")
            .on_click((_e, cx) => {
              this.pendingRemove = image.remove_target;
              this.pendingPrune = false;
              cx.notify();
            }))))

      .children(this.showTagForm
        ? [h_flex().gap(6).items_center()
          .child(div().w(200).flex_shrink_0().child(new Input(this.tagRepo)))
          .child(div().w(120).flex_shrink_0().child(new Input(this.tagName)))
          .child(new Button("docker-images-tag-apply").size("small").label(this.busy ? "Tagging…" : "Tag")
            .on_click((_e, cx) => cx.spawn(async (cx) => {
              await this.applyTag(cx);
              cx.notify();
            })))]
        : [])

      .child(section(cx, "Overview", [
        kv(cx, "Repository", text(image.name)),
        kv(cx, "Tags", tags, { mono: true }),
        kv(cx, "Image ID", pick(detail, "Id") || image.id, { mono: true }),
        kv(cx, "Size", text(image.size)),
        kv(cx, "Created", text(image.created)),
        kv(cx, "Architecture", pick(detail, "Architecture")),
        kv(cx, "OS", pick(detail, "Os", "OS")),
        kv(cx, "Docker version", pick(detail, "DockerVersion")),
        kv(cx, "Author", pick(detail, "Author")),
      ]))

      .children(this.detailLoading
        ? [div().text_size(12).text_color(cx.theme().colors.muted_foreground).child("Loading details…")]
        : [])
      .children(this.detailError
        ? [div().text_size(12).text_color(cx.theme().colors.destructive)
          .child(`Details unavailable: ${this.detailError}`)]
        : [])

      .child(section(cx, "Runtime config", [
        kv(cx, "Entrypoint", joinCommand(pick(config, "Entrypoint")), { mono: true }),
        kv(cx, "Command", joinCommand(pick(config, "Cmd")), { mono: true }),
        kv(cx, "Working dir", pick(config, "WorkingDir"), { mono: true }),
        kv(cx, "Exposed ports", Object.keys(pick(config, "ExposedPorts") || {}).join(", "), { mono: true }),
        kv(cx, "Environment", Array.isArray(env) ? `${env.length} variables` : "-"),
        kv(cx, "Labels", Object.keys(pick(config, "Labels") || {}).length || "-"),
      ]))

      .child(this.tabs(cx))
      .children(this.tab === "info"
        ? [this.historyOrLayers(cx, detail)]
        : [this.historyTable(cx)]);
  }

  tabs(cx) {
    return h_flex().gap(4).mt(2)
      .child(new Button("docker-images-tab-info").ghost().size("small").label("Image layers")
        .on_click((_e, cx) => {
          this.tab = "info";
          cx.notify();
        }))
      .child(new Button("docker-images-tab-history").ghost().size("small").label("Build history")
        .on_click((_e, cx) => {
          this.tab = "history";
          cx.notify();
        }));
  }

  historyOrLayers(cx, detail) {
    const rootFs = pick(detail, "RootFS") || {};
    const layers = pick(rootFs, "Layers");
    return section(cx, "Layers", [
      kv(cx, "Layer count", Array.isArray(layers) ? layers.length : "-"),
      kv(cx, "Graph driver", text(pick(pick(detail, "GraphDriver") || {}, "Name"))),
      kv(cx, "Parent", pick(detail, "Parent"), { mono: true }),
      kv(cx, "Repo digests", text(pick(detail, "RepoDigests", "repo_digests"), "-"), { mono: true }),
    ]);
  }

  historyTable(cx) {
    const rows = this.historyRows();
    if (rows.length === 0) {
      return section(cx, "Build history", [
        div().text_size(12).text_color(cx.theme().colors.muted_foreground)
          .child(this.detailLoading ? "Loading…" : "No history available."),
      ]);
    }
    const tableState = DataTableState(HISTORY_TITLES);
    return v_flex().gap(6)
      .child(div().font_semibold().child(`Build history (${rows.length})`))
      .child(div().h(260).child(
        new DataTable(tableState, () => rows, (row, column) =>
          div().whitespace_nowrap().child(String(row[column] ?? "")),
        ).stripe(true).bordered(true),
      ));
  }
}
