import { App, Modal, Notice, Plugin, PluginSettingTab, TFile, normalizePath, type SettingDefinitionItem } from "obsidian";
import "./widgets/index";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./view";
import type { DashboardPlugin, Settings, WidgetInstance } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { widgetType } from "./registry";
import { defaultLayout, findFirstFree } from "./layout";
import { dateKey as dk, formatDate as fmtDate, uid } from "./utils";

export default class AuroraDashboardPlugin extends Plugin implements DashboardPlugin {
	settings: Settings;
	private saveTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));

		this.addRibbonIcon("layout-dashboard", "Open dashboard", () => void this.activateView());

		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
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
		void this.app.workspace.revealLeaf(leaf);
	}

	toggleEditMode(): void {
		this.settings.editMode = !this.settings.editMode;
		void this.saveSettings();
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
			const next = cur.trimEnd() + "\n\n" + text;
			await this.app.vault.modify(existing, next);
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
		const defaults: Record<string, unknown> = { ...(t.defaultSettings ?? {}) };
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
		void this.saveSettings();
		this.rerenderDashboard();
	}
}

class QuickCaptureModal extends Modal {
	plugin: AuroraDashboardPlugin;

	constructor(app: App, plugin: AuroraDashboardPlugin) {
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
	plugin: AuroraDashboardPlugin;

	constructor(app: App, plugin: AuroraDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override getControlValue(key: string): unknown {
		if (key === "accent") return this.plugin.settings.accent || "#7c3aed";
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	override setControlValue(key: string, value: unknown): void | Promise<void> {
		const ret = super.setControlValue(key, value);
		if (key === "captureTarget") this.refreshDomState();
		return ret;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		return [
			{
				type: "group",
				heading: "Layout",
				items: [
					{
						name: "Columns",
						desc: "Number of grid columns. More columns means finer-grained widget sizing.",
						control: { type: "slider", key: "columns", min: 8, max: 16, step: 1 },
					},
					{
						name: "Row height",
						control: { type: "slider", key: "rowHeight", min: 60, max: 140, step: 4 },
					},
					{
						name: "Gap",
						desc: "Spacing between widgets.",
						control: { type: "slider", key: "gap", min: 8, max: 28, step: 2 },
					},
					{
						name: "Edit mode",
						desc: "Show widget handles for dragging, resizing and removing.",
						control: { type: "toggle", key: "editMode" },
					},
					{
						name: "Reset layout",
						action: () => {
							s.layout = defaultLayout();
							void this.plugin.saveSettings();
							this.plugin.rerenderDashboard();
						},
					},
				],
			},
			{
				type: "group",
				heading: "Appearance",
				items: [
					{
						name: "Accent color",
						desc: "Used for highlights, charts and progress.",
						control: { type: "color", key: "accent" },
					},
					{
						name: "Reset to theme accent",
						action: () => {
							s.accent = "";
							void this.plugin.saveSettings();
							this.plugin.rerenderDashboard();
							this.update();
						},
					},
					{
						name: "Accent presets",
						desc: "One-click options.",
						render: (setting) => {
							const wrap = setting.controlEl.createDiv("dash-accent-presets");
							for (const c of ["#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"]) {
								const sw = wrap.createDiv("dash-accent-swatch");
								sw.style.setProperty("--dash-accent", c);
								sw.setAttr("aria-label", c);
								sw.addEventListener("click", () => {
									s.accent = c;
									void this.plugin.saveSettings();
									this.plugin.rerenderDashboard();
									this.update();
								});
							}
						},
					},
				],
			},
			{
				type: "group",
				heading: "Activity",
				items: [
					{
						name: "Track activity",
						desc: "Record note edits to power the heatmap, streaks and stats.",
						control: { type: "toggle", key: "trackActivity" },
					},
					{
						name: "Clear data",
						action: () => {
							s.activity = {};
							void this.plugin.saveSettings();
							this.plugin.rerenderDashboard();
						},
					},
				],
			},
			{
				type: "group",
				heading: "Daily notes",
				items: [
					{
						name: "Daily note folder",
						desc: "Optional folder for daily notes (blank = vault root).",
						control: { type: "text", key: "dailyNoteFolder", placeholder: "e.g. Daily" },
					},
					{
						name: "Daily note format",
						desc: "Tokens: YYYY, YY, MMM, MM, DD, ddd.",
						control: { type: "text", key: "dailyNoteFormat", placeholder: "YYYY-MM-DD" },
					},
				],
			},
			{
				type: "group",
				heading: "Capture",
				items: [
					{
						name: "Capture target",
						control: { type: "dropdown", key: "captureTarget", options: { inbox: "Inbox file", daily: "Today's daily note" } },
					},
					{
						name: "Capture folder",
						desc: "Optional folder for the inbox file.",
						control: { type: "text", key: "captureFolder", placeholder: "e.g. Inbox" },
						visible: () => s.captureTarget === "inbox",
					},
					{
						name: "Inbox file",
						control: { type: "text", key: "inboxFile", placeholder: "Inbox.md" },
						visible: () => s.captureTarget === "inbox",
					},
				],
			},
			{
				type: "group",
				heading: "Pomodoro",
				items: [
					{
						name: "Focus length",
						desc: "Default work interval (min) for new Pomodoro widgets. Existing widgets keep their own value.",
						control: { type: "number", key: "pomodoroFocus", min: 1, max: 120, placeholder: "25" },
					},
					{
						name: "Break length",
						desc: "Default break (min) for new Pomodoro widgets. Existing widgets keep their own value.",
						control: { type: "number", key: "pomodoroBreak", min: 1, max: 60, placeholder: "5" },
					},
				],
			},
		];
	}
}
