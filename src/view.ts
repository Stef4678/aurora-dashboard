import { App, ItemView, Modal, Notice, Setting, WorkspaceLeaf, setIcon } from "obsidian";
import type { DashboardPlugin, WidgetCtx, WidgetHandle, WidgetInstance, WidgetSetting, WidgetType } from "./types";
import { getWidgetTypes, widgetType } from "./registry";
import { gridRows, hasOverlap, nearestFree, resolveOverlaps } from "./layout";
import { clamp } from "./utils";

export const VIEW_TYPE_DASHBOARD = "cool-dashboard-view";

export class DashboardView extends ItemView {
	plugin: DashboardPlugin;
	private gridEl!: HTMLElement;
	private dropTarget!: HTMLElement;
	private handles = new Map<string, { dispose?: () => void }>();
	private cleanups: Array<() => void> = [];

	constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}
	getDisplayText(): string {
		return "Dashboard";
	}
	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	onClose(): Promise<void> {
		this.runCleanups();
		this.disposeAll();
		return Promise.resolve();
	}

	// ---- lifecycle ----

	private runCleanups(): void {
		for (const fn of this.cleanups) {
			try {
				fn();
			} catch {
				/* noop */
			}
		}
		this.cleanups = [];
	}

	private disposeAll(): void {
		for (const h of this.handles.values()) {
			try {
				h.dispose?.();
			} catch {
				/* noop */
			}
		}
		this.handles.clear();
	}

	render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("dash-view");
		if (this.plugin.settings.accent) contentEl.style.setProperty("--dash-accent", this.plugin.settings.accent);
		else contentEl.style.removeProperty("--dash-accent");
		if (this.plugin.settings.editMode) contentEl.addClass("editing");
		else contentEl.removeClass("editing");

		this.runCleanups();
		this.disposeAll();

		contentEl.createDiv("dash-scroll", (scroll) => {
			scroll.createDiv("dash-shell", (shell) => {
				this.buildControlBar(shell);
				this.gridEl = shell.createDiv("dash-grid");
				this.applyGrid();
				this.dropTarget = this.gridEl.createDiv("dash-drop-target");
				this.buildWidgets();
			});
		});
	}

	// ---- control center ----

	private greeting(): string {
		const h = new Date().getHours();
		if (h < 5) return "Burning the midnight oil";
		if (h < 12) return "Good morning";
		if (h < 18) return "Good afternoon";
		return "Good evening";
	}

	private buildControlBar(shell: HTMLElement): void {
		const bar = shell.createDiv("dash-control");
		const left = bar.createDiv("dash-control-left");
		const logo = left.createDiv("dash-logo");
		setIcon(logo, "layout-dashboard");
		const brand = left.createDiv("dash-brand");
		brand.createDiv("dash-brand-title").setText("Control Center");
		brand.createDiv("dash-brand-sub").setText(
			`${this.greeting()} · ${new Date().toLocaleDateString(undefined, {
				weekday: "long",
				month: "long",
				day: "numeric",
			})}`
		);

		const right = bar.createDiv("dash-control-right");

		const clockChip = right.createDiv("dash-chip dash-chip-time");
		const tick = (): void => clockChip.setText(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
		tick();
		const clockTimer = window.setInterval(tick, 1000);
		this.cleanups.push(() => window.clearInterval(clockTimer));

		const searchBtn = right.createDiv("dash-btn dash-btn-ghost");
		setIcon(searchBtn, "search");
		searchBtn.setAttr("aria-label", "Search");
		searchBtn.addEventListener("click", () => void this.plugin.openSearch(""));

		const captureBtn = right.createDiv("dash-btn dash-btn-ghost");
		setIcon(captureBtn, "send");
		captureBtn.setAttr("aria-label", "Quick capture");
		captureBtn.addEventListener("click", () => this.plugin.showQuickCapture());

		const editing = this.plugin.settings.editMode;
		const editBtn = right.createDiv("dash-btn " + (editing ? "dash-btn-active" : "dash-btn-ghost"));
		setIcon(editBtn, editing ? "check" : "pencil");
		editBtn.setAttr("aria-label", editing ? "Done editing" : "Edit layout");
		editBtn.addEventListener("click", () => {
			this.plugin.settings.editMode = !this.plugin.settings.editMode;
			this.plugin.saveSettings();
			this.render();
		});

		if (editing) {
			const addBtn = right.createDiv("dash-btn dash-btn-accent");
			setIcon(addBtn, "plus");
			addBtn.setAttr("aria-label", "Add widget");
			addBtn.addEventListener("click", () => new AddWidgetModal(this.app, this.plugin).open());
		}
	}

	// ---- grid ----

	private applyGrid(): void {
		const s = this.plugin.settings;
		this.gridEl.style.setProperty("--dash-cols", String(s.columns));
		this.gridEl.style.setProperty("--dash-row", s.rowHeight + "px");
		this.gridEl.style.setProperty("--dash-gap", s.gap + "px");
	}

	private buildWidgets(): void {
		for (const inst of this.plugin.settings.layout) this.buildWidgetCard(inst);
	}

	private buildWidgetCard(inst: WidgetInstance): void {
		const type = widgetType(inst.type);
		if (!type) return;
		const card = this.gridEl.createDiv({
			cls: "dash-widget",
			attr: { "data-uid": inst.uid, "data-type": inst.type },
		});
		if (type.noHeader) card.addClass("no-header");
		this.position(card, inst);
		this.buildWidgetHeader(card, inst, type);
		const body = card.createDiv("dash-widget-body widget-" + type.type);
		this.renderWidgetBody(body, inst);
		if (this.plugin.settings.editMode) {
			this.enableDrag(card, inst);
			this.enableResize(card, inst);
		}
	}

	private position(card: HTMLElement, inst: WidgetInstance): void {
		card.style.gridColumn = `${inst.x + 1} / span ${inst.w}`;
		card.style.gridRow = `${inst.y + 1} / span ${inst.h}`;
	}

	private buildWidgetHeader(card: HTMLElement, inst: WidgetInstance, type: WidgetType): void {
		if (type.noHeader) return;
		const header = card.createDiv("dash-widget-header");
		const grip = header.createDiv("dash-grip");
		setIcon(grip, "grip-vertical");
		const icon = header.createDiv("dash-widget-icon");
		setIcon(icon, type.icon);
		header.createDiv("dash-widget-title").setText(inst.title || type.name);
		const actions = header.createDiv("dash-widget-actions");
		if (this.plugin.settings.editMode) {
			const gear = actions.createDiv("dash-btn");
			setIcon(gear, "settings-2");
			gear.setAttr("aria-label", "Widget settings");
			gear.addEventListener("click", () => this.openWidgetSettings(inst));
			const del = actions.createDiv("dash-btn dash-btn-danger");
			setIcon(del, "x");
			del.setAttr("aria-label", "Remove widget");
			del.addEventListener("click", () => {
				this.plugin.settings.layout = this.plugin.settings.layout.filter((i) => i.uid !== inst.uid);
				this.plugin.saveSettings();
				this.render();
			});
		}
	}

	private renderWidgetBody(body: HTMLElement, inst: WidgetInstance): void {
		const type = widgetType(inst.type);
		if (!type) return;
		const prev = this.handles.get(inst.uid);
		try {
			prev?.dispose?.();
		} catch {
			/* noop */
		}
		while (body.firstChild) body.removeChild(body.firstChild);

		const ctx: WidgetCtx = {
			plugin: this.plugin,
			inst,
			body,
			refresh: () => this.refreshWidget(inst.uid),
		};
		let handle: WidgetHandle = {};
		try {
			handle = type.render(ctx);
		} catch (e) {
			console.error("Dashboard widget failed to render:", inst.type, e);
			body.createDiv("dash-widget-error").setText("This widget hit a snag — try again.");
		}
		this.handles.set(inst.uid, { dispose: handle.dispose });
	}

	refreshWidget(uid: string): void {
		const card = this.gridEl.querySelector<HTMLElement>(`.dash-widget[data-uid="${uid}"]`);
		if (!card) return;
		const body = card.querySelector<HTMLElement>(".dash-widget-body");
		const inst = this.plugin.settings.layout.find((i) => i.uid === uid);
		if (body && inst) this.renderWidgetBody(body, inst);
	}

	refreshActivityWidgets(): void {
		for (const t of ["activity", "stats", "tasks", "calendar", "recent"]) this.refreshAllOfType(t);
	}

	private refreshAllOfType(type: string): void {
		this.gridEl
			.querySelectorAll<HTMLElement>(`.dash-widget[data-type="${type}"]`)
			.forEach((card) => {
				const body = card.querySelector<HTMLElement>(".dash-widget-body");
				const inst = this.plugin.settings.layout.find((i) => i.uid === card.getAttribute("data-uid"));
				if (body && inst) this.renderWidgetBody(body, inst);
			});
	}

	// ---- drag & drop ----

	private cellAt(clientX: number, clientY: number): { x: number; y: number } {
		const s = this.plugin.settings;
		const rect = this.gridEl.getBoundingClientRect();
		const cw = (rect.width - s.gap * (s.columns - 1)) / s.columns;
		const x = clamp(Math.floor((clientX - rect.left) / (cw + s.gap)), 0, s.columns - 1);
		const y = clamp(
			Math.floor((clientY - rect.top) / (s.rowHeight + s.gap)),
			0,
			Math.max(gridRows(this.plugin.settings.layout) - 1, 0)
		);
		return { x, y };
	}

	private showDropTarget(x: number, y: number): void {
		const s = this.plugin.settings;
		const rect = this.gridEl.getBoundingClientRect();
		const cw = (rect.width - s.gap * (s.columns - 1)) / s.columns;
		this.dropTarget.style.left = x * (cw + s.gap) + "px";
		this.dropTarget.style.top = y * (s.rowHeight + s.gap) + "px";
		this.dropTarget.style.width = cw + "px";
		this.dropTarget.style.height = s.rowHeight + "px";
		this.dropTarget.addClass("is-visible");
	}

	private hideDropTarget(): void {
		this.dropTarget.removeClass("is-visible");
	}

	private enableDrag(card: HTMLElement, inst: WidgetInstance): void {
		const grip = card.querySelector<HTMLElement>(".dash-grip");
		if (!grip) return;
		grip.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			card.addClass("is-dragging");
			const drag = {
				inst,
				card,
				startX: e.clientX,
				startY: e.clientY,
				lastX: e.clientX,
				lastY: e.clientY,
			};

			const onMove = (ev: PointerEvent): void => {
				drag.lastX = ev.clientX;
				drag.lastY = ev.clientY;
				card.style.transform = `translate3d(${ev.clientX - drag.startX}px, ${ev.clientY - drag.startY}px, 0) scale(1.03)`;
				const cell = this.cellAt(ev.clientX, ev.clientY);
				this.showDropTarget(cell.x, cell.y);
			};
			const onUp = (): void => {
				document.removeEventListener("pointermove", onMove);
				document.removeEventListener("pointerup", onUp);
				card.removeClass("is-dragging");
				card.style.transform = "";
				this.hideDropTarget();
				const cell = this.cellAt(drag.lastX, drag.lastY);
				this.placeInstance(inst, cell.x, cell.y);
			};

			document.addEventListener("pointermove", onMove);
			document.addEventListener("pointerup", onUp);
		});
	}

	private placeInstance(inst: WidgetInstance, col: number, row: number): void {
		const s = this.plugin.settings;
		const layout = s.layout;
		col = clamp(col, 0, s.columns - 1);
		row = Math.max(row, 0);

		const occupant = layout.find((i) => i.uid !== inst.uid && i.x === col && i.y === row);

		if (occupant) {
			const oldX = inst.x;
			const oldY = inst.y;
			inst.x = col;
			inst.y = row;
			occupant.x = oldX;
			occupant.y = oldY;
			if (hasOverlap(layout, inst) || hasOverlap(layout, occupant)) {
				inst.x = oldX;
				inst.y = oldY;
				occupant.x = col;
				occupant.y = row;
				const free = nearestFree(layout, inst, col, row, s.columns);
				inst.x = free.x;
				inst.y = free.y;
			}
		} else {
			const free = nearestFree(layout, inst, col, row, s.columns);
			inst.x = free.x;
			inst.y = free.y;
		}

		resolveOverlaps(layout, s.columns);
		this.plugin.saveSettings();
		this.render();
	}

	private enableResize(card: HTMLElement, inst: WidgetInstance): void {
		const type = widgetType(inst.type);
		const min = type?.min ?? { w: 2, h: 2 };
		const maxW = type?.max?.w ?? this.plugin.settings.columns;
		const maxH = type?.max?.h ?? 8;
		const handle = card.createDiv("dash-resize");
		handle.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const s = this.plugin.settings;
			const rect = this.gridEl.getBoundingClientRect();
			const cw = (rect.width - s.gap * (s.columns - 1)) / s.columns;
			const ch = s.rowHeight;
			const startW = inst.w;
			const startH = inst.h;
			const sx = e.clientX;
			const sy = e.clientY;

			const onMove = (ev: PointerEvent): void => {
				const dCols = Math.round((ev.clientX - sx) / (cw + s.gap));
				const dRows = Math.round((ev.clientY - sy) / (ch + s.gap));
				inst.w = clamp(startW + dCols, min.w, Math.min(maxW, s.columns - inst.x));
				inst.h = clamp(startH + dRows, min.h, maxH);
				this.position(card, inst);
			};
			const onUp = (): void => {
				document.removeEventListener("pointermove", onMove);
				document.removeEventListener("pointerup", onUp);
				resolveOverlaps(this.plugin.settings.layout, this.plugin.settings.columns);
				this.plugin.saveSettings();
				this.render();
			};

			document.addEventListener("pointermove", onMove);
			document.addEventListener("pointerup", onUp);
		});
	}

	// ---- settings ----

	private openWidgetSettings(inst: WidgetInstance): void {
		const type = widgetType(inst.type);
		if (!type?.settings?.length && !inst.title) {
			new Notice("No settings for this widget.");
			return;
		}
		new WidgetSettingsModal(this.app, this.plugin, inst).open();
	}
}

class AddWidgetModal extends Modal {
	plugin: DashboardPlugin;

	constructor(app: App, plugin: DashboardPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.titleEl.setText("Add a widget");
		const list = this.contentEl.createDiv("dash-modal-list");
		for (const t of getWidgetTypes()) {
			const row = list.createDiv("dash-modal-row");
			const icon = row.createDiv("dash-modal-icon");
			setIcon(icon, t.icon);
			const info = row.createDiv("dash-modal-info");
			info.createDiv("dash-modal-name").setText(t.name);
			info.createDiv("dash-modal-desc").setText(t.description);
			row.addEventListener("click", () => {
				this.plugin.addWidget(t.type);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class WidgetSettingsModal extends Modal {
	plugin: DashboardPlugin;
	inst: WidgetInstance;

	constructor(app: App, plugin: DashboardPlugin, inst: WidgetInstance) {
		super(app);
		this.plugin = plugin;
		this.inst = inst;
	}

	onOpen(): void {
		const type = widgetType(this.inst.type);
		this.titleEl.setText((this.inst.title || type?.name || "Widget") + " — settings");
		const { contentEl } = this;
		contentEl.empty();
		if (!type) return;

		if (!type.noHeader) {
			new Setting(contentEl)
				.setName("Title")
				.setDesc("Leave blank to use the default")
				.addText((tb) => {
					tb.setValue(this.inst.title ?? "");
					tb.onChange((v) => {
						this.inst.title = v || undefined;
						this.commit();
					});
				});
		}

		for (const cfg of type.settings ?? []) this.addSetting(contentEl, cfg);

		contentEl.createDiv("dash-modal-gap");
		const done = contentEl.createDiv("dash-modal-foot");
		const btn = done.createDiv("dash-btn dash-btn-accent");
		btn.setText("Done");
		btn.addEventListener("click", () => this.close());
	}

	private addSetting(contentEl: HTMLElement, cfg: WidgetSetting): void {
		const st = new Setting(contentEl).setName(cfg.label);
		const commit = (): void => {
			this.plugin.saveSettings();
			this.plugin.refreshWidget(this.inst.uid);
		};

		if (cfg.type === "toggle") {
			st.addToggle((tg) =>
				tg.setValue(!!this.inst.settings[cfg.key]).onChange((v) => {
					this.inst.settings[cfg.key] = v;
					commit();
				})
			);
		} else if (cfg.type === "select") {
			st.addDropdown((dd) => {
				for (const o of cfg.options ?? []) dd.addOption(o, o);
				dd.setValue(String(this.inst.settings[cfg.key] ?? cfg.options?.[0] ?? "")).onChange((v) => {
					this.inst.settings[cfg.key] = v;
					commit();
				});
			});
		} else if (cfg.type === "number") {
			st.addText((tb) => {
				tb.inputEl.type = "number";
				tb.setValue(String(this.inst.settings[cfg.key] ?? ""));
				tb.onChange((v) => {
					const n = parseFloat(v);
					let val = Number.isFinite(n) ? n : (cfg.min ?? 0);
					if (cfg.min !== undefined) val = Math.max(cfg.min, val);
					if (cfg.max !== undefined) val = Math.min(cfg.max, val);
					this.inst.settings[cfg.key] = val;
					commit();
				});
			});
		} else {
			st.addText((tb) => {
				tb.setValue(String(this.inst.settings[cfg.key] ?? ""));
				tb.setPlaceholder(cfg.placeholder ?? "");
				tb.onChange((v) => {
					this.inst.settings[cfg.key] = v;
					commit();
				});
			});
		}
	}

	private commit(): void {
		this.plugin.saveSettings();
		this.plugin.refreshWidget(this.inst.uid);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
