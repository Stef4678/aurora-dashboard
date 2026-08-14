import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import "./widgets/index";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./view";
import type { DashboardPlugin, Settings, WidgetInstance } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { widgetType } from "./registry";
import { defaultLayout, findFirstFree } from "./layout";
import { clamp, dateKey as dk, formatDate as fmtDate, uid } from "./utils";

export default class CoolDashboardPlugin extends Plugin implements DashboardPlugin {
	settings: Settings;
	private saveTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));

		this.addRibbonIcon("layout-dashboard", "Open dashboard", () => void this.activateView());

		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "D" }],
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: "toggle-edit-mode",
			name: "Toggle dashboard edit mode",
			callback: () => this.toggleEditMode(),
		});
		this.addCommand({
			id: "capture-to-inbox",
			name: "Capture to inbox",
			callback: () => this.showQuickCapture(),
		});

		this.addSettingTab(new DashboardSettingTab(this.app, this));

		this.registerEvent(this.app.vault.on("create", (f) => this.onFileActivity(f)));
		this.registerEvent(this.app.vault.on("modify", (f) => this.onFileActivity(f)));
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
	}

	// ---- data ----

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<Settings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
		if (!Array.isArray(this.settings.layout) || this.settings.layout.length === 0) {
			this.settings.layout = defaultLayout();
		}
		this.settings.activity = this.settings.activity ?? {};
		this.settings.layout = this.settings.layout
			.filter((i) => widgetType(i.type))
			.map((inst) => {
				const t = widgetType(inst.type);
				if (!inst.uid) inst.uid = uid();
				if (t?.defaultSettings) inst.settings = Object.assign({}, t.defaultSettings, inst.settings ?? {});
				return inst;
			});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private queueSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveSettings();
		}, 500);
	}

	private forDashboard(fn: (v: DashboardView) => void): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
			if (leaf.view instanceof DashboardView) fn(leaf.view);
		}
	}

	rerenderDashboard(): void {
		this.forDashboard((v) => v.render());
	}

	// ---- commands / navigation ----

	async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
		if (existing.length) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	toggleEditMode(): void {
		this.settings.editMode = !this.settings.editMode;
		this.saveSettings();
		this.rerenderDashboard();
	}

	openFile(f: TFile | null): void {
		if (f) void this.app.workspace.getLeaf(false).openFile(f);
	}

	async openDay(d: Date): Promise<void> {
		const path = this.dailyNotePath(d);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(existing);
			return;
		}
		try {
			const f = await this.app.vault.create(path, "");
			await this.app.workspace.getLeaf(false).openFile(f);
		} catch {
			new Notice("Could not create the note for that day.");
		}
	}

	async openSearch(query: string): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: "search", state: { query } });
	}

	// ---- daily notes ----

	formatDate(d: Date, fmt: string): string {
		return fmtDate(d, fmt);
	}

	dailyNotePath(d: Date): string {
		const name = this.formatDate(d, this.settings.dailyNoteFormat);
		const folder = this.settings.dailyNoteFolder.trim();
		return normalizePath(folder ? folder + "/" + name + ".md" : name + ".md");
	}

	noteExistsFor(d: Date): boolean {
		return this.app.vault.getAbstractFileByPath(this.dailyNotePath(d)) instanceof TFile;
	}

	// ---- activity tracking ----

	private onFileActivity(file: unknown): void {
		if (this.settings.trackActivity && file instanceof TFile && file.extension === "md") {
			this.recordActivity();
		}
	}

	recordActivity(): void {
		const key = dk(new Date());
		this.settings.activity[key] = (this.settings.activity[key] ?? 0) + 1;
		this.queueSave();
		this.refreshActivityWidgets();
	}

	refreshActivityWidgets(): void {
		this.forDashboard((v) => v.refreshActivityWidgets());
	}

	refreshWidget(uid: string): void {
		this.forDashboard((v) => v.refreshWidget(uid));
	}

	// ---- capture ----

	showQuickCapture(): void {
		new QuickCaptureModal(this.app, this).open();
	}

	async captureText(text: string): Promise<void> {
		const s = this.settings;
		if (s.captureTarget === "inbox") {
			const dir = normalizePath(s.captureFolder.trim());
			await this.ensureFolder(dir);
			const path = normalizePath((dir ? dir + "/" : "") + s.inboxFile);
			await this.appendTo(path, text);
		} else {
			const path = this.dailyNotePath(new Date());
			const slash = path.lastIndexOf("/");
			const dir = slash > 0 ? path.slice(0, slash) : "";
			await this.ensureFolder(dir);
			await this.appendTo(path, `### ${new Date().toLocaleTimeString()}\n${text}`);
		}
		new Notice("Captured");
	}

	private async ensureFolder(dir: string): Promise<void> {
		if (!dir) return;
		if (this.app.vault.getAbstractFileByPath(dir)) return;
		try {
			await this.app.vault.createFolder(dir);
		} catch {
			/* folder may have appeared already */
		}
	}

	private async appendTo(path: string, text: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			const cur = await this.app.vault.read(existing);
			await this.app.vault.modify(existing, cur.trimEnd() + "\n\n" + text);
		} else {
			await this.app.vault.create(path, text);
		}
	}

	// ---- widgets ----

	addWidget(type: string): void {
		const t = widgetType(type);
		if (!t) return;
		const size = t.defaultSize;
		const pos = findFirstFree(this.settings.layout, size, this.settings.columns);
		const defaults = Object.assign({}, t.defaultSettings ?? {});
		if (type === "pomodoro") {
			defaults.focus = this.settings.pomodoroFocus;
			defaults.break = this.settings.pomodoroBreak;
		}
		const inst: WidgetInstance = {
			type,
			uid: uid(),
			x: pos.x,
			y: pos.y,
			w: size.w,
			h: size.h,
			settings: defaults,
		};
		this.settings.layout.push(inst);
		this.saveSettings();
		this.rerenderDashboard();
	}
}

class QuickCaptureModal extends Modal {
	plugin: CoolDashboardPlugin;

	constructor(app: App, plugin: CoolDashboardPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.titleEl.setText("Quick capture");
		const ta = this.contentEl.createEl("textarea", {
			cls: "dash-capture-input dash-modal-capture",
			attr: { placeholder: "Capture a thought…" },
		});
		const foot = this.contentEl.createDiv("dash-modal-foot");
		const target =
			this.plugin.settings.captureTarget === "daily"
				? "today's note"
				: this.plugin.settings.inboxFile;
		foot.createDiv("dash-capture-hint").setText("→ " + target);
		const btn = foot.createDiv("dash-btn dash-btn-accent");
		btn.setText("Capture");

		const doIt = async (): Promise<void> => {
			const t = ta.value.trim();
			if (!t) return;
			await this.plugin.captureText(t);
			this.close();
		};

		btn.addEventListener("click", () => void doIt());
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void doIt();
			}
		});
		ta.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class DashboardSettingTab extends PluginSettingTab {
	plugin: CoolDashboardPlugin;

	constructor(app: App, plugin: CoolDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl).setName("Layout").setHeading();
		new Setting(containerEl)
			.setName("Columns")
			.setDesc("Number of grid columns. More columns means finer-grained widget sizing.")
			.addSlider((sl) =>
				sl
					.setLimits(8, 16, 1)
					.setValue(s.columns)
					.setDynamicTooltip()
					.onChange((v) => {
						s.columns = v;
						this.plugin.saveSettings();
						this.plugin.rerenderDashboard();
					})
			);
		new Setting(containerEl)
			.setName("Row height")
			.addSlider((sl) =>
				sl
					.setLimits(60, 140, 4)
					.setValue(s.rowHeight)
					.setDynamicTooltip()
					.onChange((v) => {
						s.rowHeight = v;
						this.plugin.saveSettings();
						this.plugin.rerenderDashboard();
					})
			);
		new Setting(containerEl)
			.setName("Gap")
			.setDesc("Spacing between widgets.")
			.addSlider((sl) =>
				sl
					.setLimits(8, 28, 2)
					.setValue(s.gap)
					.setDynamicTooltip()
					.onChange((v) => {
						s.gap = v;
						this.plugin.saveSettings();
						this.plugin.rerenderDashboard();
					})
			);
		new Setting(containerEl)
			.setName("Edit mode")
			.setDesc("Show widget handles for dragging, resizing and removing.")
			.addToggle((tg) =>
				tg.setValue(s.editMode).onChange((v) => {
					s.editMode = v;
					this.plugin.saveSettings();
					this.plugin.rerenderDashboard();
				})
			)
			.addButton((b) =>
				b.setButtonText("Reset layout").onClick(() => {
					s.layout = defaultLayout();
					this.plugin.saveSettings();
					this.plugin.rerenderDashboard();
				})
			);

		new Setting(containerEl).setName("Appearance").setHeading();
		new Setting(containerEl)
			.setName("Accent color")
			.setDesc("Used for highlights, charts and progress.")
			.addColorPicker((cp) =>
				cp
					.setValue(s.accent || "#7c3aed")
					.onChange((v) => {
						s.accent = v;
						this.plugin.saveSettings();
						this.plugin.rerenderDashboard();
					})
			)
			.addExtraButton((btn) =>
				btn.setIcon("rotate-ccw").setTooltip("Reset to theme accent").onClick(() => {
					s.accent = "";
					this.plugin.saveSettings();
					this.plugin.rerenderDashboard();
					this.display();
				})
			);
		const swatches = new Setting(containerEl).setName("Accent presets").setDesc("One-click options.");
		const wrap = swatches.controlEl.createDiv("dash-accent-presets");
		for (const c of ["#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"]) {
			const sw = wrap.createDiv("dash-accent-swatch");
			sw.style.background = c;
			sw.addEventListener("click", () => {
				s.accent = c;
				this.plugin.saveSettings();
				this.plugin.rerenderDashboard();
			});
		}

		new Setting(containerEl).setName("Activity").setHeading();
		new Setting(containerEl)
			.setName("Track activity")
			.setDesc("Record note edits to power the heatmap, streaks and stats.")
			.addToggle((tg) =>
				tg.setValue(s.trackActivity).onChange((v) => {
					s.trackActivity = v;
					this.plugin.saveSettings();
				})
			)
			.addButton((b) =>
				b.setButtonText("Clear data").setWarning().onClick(() => {
					s.activity = {};
					this.plugin.saveSettings();
					this.plugin.rerenderDashboard();
				})
			);

		new Setting(containerEl).setName("Daily notes").setHeading();
		new Setting(containerEl)
			.setName("Daily note folder")
			.setDesc("Optional folder for daily notes (blank = vault root).")
			.addText((tb) =>
				tb
					.setPlaceholder("e.g. Daily")
					.setValue(s.dailyNoteFolder)
					.onChange((v) => {
						s.dailyNoteFolder = v;
						this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Daily note format")
			.setDesc("Tokens: YYYY, YY, MMM, MM, DD, ddd.")
			.addText((tb) =>
				tb
					.setPlaceholder("YYYY-MM-DD")
					.setValue(s.dailyNoteFormat)
					.onChange((v) => {
						s.dailyNoteFormat = v;
						this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Capture").setHeading();
		new Setting(containerEl)
			.setName("Capture target")
			.addDropdown((dd) =>
				dd
					.addOption("inbox", "Inbox file")
					.addOption("daily", "Today's daily note")
					.setValue(s.captureTarget)
					.onChange((v) => {
						s.captureTarget = v as Settings["captureTarget"];
						this.plugin.saveSettings();
						this.display();
					})
			);
		if (s.captureTarget === "inbox") {
			new Setting(containerEl)
				.setName("Capture folder")
				.setDesc("Optional folder for the inbox file.")
				.addText((tb) =>
					tb
						.setPlaceholder("e.g. Inbox")
						.setValue(s.captureFolder)
						.onChange((v) => {
							s.captureFolder = v;
							this.plugin.saveSettings();
						})
				);
			new Setting(containerEl)
				.setName("Inbox file")
				.addText((tb) =>
					tb
						.setPlaceholder("Inbox.md")
						.setValue(s.inboxFile)
						.onChange((v) => {
							s.inboxFile = v;
							this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl).setName("Pomodoro").setHeading();
		new Setting(containerEl)
			.setName("Focus length")
			.setDesc("Default work interval (min) for new Pomodoro widgets. Existing widgets keep their own value.")
			.addText((tb) =>
				tb
					.setPlaceholder("25")
					.setValue(String(s.pomodoroFocus))
					.onChange((v) => {
						s.pomodoroFocus = clamp(parseInt(v, 10) || 25, 1, 120);
						this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Break length")
			.setDesc("Default break (min) for new Pomodoro widgets. Existing widgets keep their own value.")
			.addText((tb) =>
				tb
					.setPlaceholder("5")
					.setValue(String(s.pomodoroBreak))
					.onChange((v) => {
						s.pomodoroBreak = clamp(parseInt(v, 10) || 5, 1, 60);
						this.plugin.saveSettings();
					})
			);
	}
}
