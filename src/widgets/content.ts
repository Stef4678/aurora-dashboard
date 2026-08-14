import { setIcon, TFile } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { relTime } from "../utils";

export const recentType: WidgetType = {
	type: "recent",
	name: "Recent",
	description: "Notes you touched recently",
	icon: "history",
	defaultSize: { w: 5, h: 3 },
	settings: [{ key: "count", label: "Number of notes", type: "number", min: 3, max: 20 }],
	render(ctx) {
		const count = Math.max(3, Math.min(20, Number(ctx.inst.settings.count ?? 8) || 8));
		const files = ctx.plugin.app.vault
			.getMarkdownFiles()
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, count);

		const list = ctx.body.createDiv("dash-list");
		for (const f of files) {
			const row = list.createDiv("dash-list-row");
			const icon = row.createDiv("dash-list-icon");
			setIcon(icon, "file-text");
			row.createDiv("dash-list-name").setText(f.basename);
			row.createDiv("dash-list-meta").setText(relTime(f.stat.mtime));
			row.addEventListener("click", () => ctx.plugin.openFile(f));
		}
		return {};
	},
};

export const tagsType: WidgetType = {
	type: "tags",
	name: "Tags",
	description: "Your most-used tags, click to search",
	icon: "tag",
	defaultSize: { w: 3, h: 3 },
	settings: [{ key: "count", label: "Number of tags", type: "number", min: 3, max: 20 }],
	render(ctx) {
		const count = Math.max(3, Math.min(20, Number(ctx.inst.settings.count ?? 10) || 10));
		const counts = new Map<string, number>();
		const files = ctx.plugin.app.vault.getMarkdownFiles().slice(0, 1500);
		for (const f of files) {
			const cache = ctx.plugin.app.metadataCache.getFileCache(f);
			for (const t of cache?.tags ?? []) {
				const name = t.tag.replace(/^#/, "");
				counts.set(name, (counts.get(name) ?? 0) + 1);
			}
		}
		const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);

		const list = ctx.body.createDiv("dash-list");
		for (const [tag, n] of top) {
			const row = list.createDiv("dash-list-row");
			const icon = row.createDiv("dash-list-icon");
			setIcon(icon, "hash");
			row.createDiv("dash-list-name").setText("#" + tag);
			row.createDiv("dash-list-meta").setText(String(n));
			row.addEventListener("click", () => ctx.plugin.openSearch("tag:" + tag));
		}
		return {};
	},
};

export const tasksType: WidgetType = {
	type: "tasks",
	name: "Today",
	description: "Checkboxes from your daily note",
	icon: "check-square",
	defaultSize: { w: 4, h: 3 },
	render(ctx) {
		const plugin = ctx.plugin;
		const path = plugin.dailyNotePath(new Date());
		const body = ctx.body;

		const load = async (): Promise<void> => {
			body.empty();
			const file = plugin.app.vault.getAbstractFileByPath(path);
			const list = body.createDiv("dash-list");

			if (!(file instanceof TFile)) {
				list.createDiv("dash-empty").setText("No daily note yet — add one below");
				addBar();
				return;
			}

			const text = await plugin.app.vault.read(file);
			const open: string[] = [];
			const done: string[] = [];
			for (const ln of text.split("\n")) {
				const m = ln.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
				if (!m) continue;
				((m[1] === " ") ? open : done).push(m[2]);
			}

			for (const t of open.slice(0, 20)) addRow(list, t, false);
			if (done.length) {
				list.createDiv("dash-divider").setText(`Completed (${done.length})`);
				for (const t of done.slice(0, 5)) addRow(list, t, true);
			}
			if (!open.length && !done.length) {
				list.createDiv("dash-empty").setText("Nothing here yet");
			}
			addBar();
		};

		const addBar = (): void => {
			const bar = body.createDiv("dash-add-row");
			const input = bar.createEl("input", {
				cls: "dash-task-input",
				attr: { placeholder: "Add a task for today…" },
			});
			const btn = bar.createDiv("dash-btn dash-btn-accent");
			setIcon(btn, "plus");
			btn.addEventListener("click", () => void addNewTask(input.value.trim()));
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void addNewTask(input.value.trim());
				}
			});
		};

		const addRow = (list: HTMLElement, text: string, isDone: boolean): void => {
			const row = list.createDiv("dash-list-row dash-task");
			const cb = row.createDiv("dash-check" + (isDone ? " is-checked" : ""));
			setIcon(cb, isDone ? "check-circle" : "circle");
			row.createDiv("dash-list-name" + (isDone ? " is-done" : "")).setText(text);
			cb.addEventListener("click", () => void toggleTask(text));
		};

		const toggleTask = async (text: string): Promise<void> => {
			const file = plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return;
			const cur = await plugin.app.vault.read(file);
			const out = cur
				.split("\n")
				.map((ln) => {
					const m = ln.match(/^(\s*[-*])\s+\[([ xX])\]\s+(.+)$/);
					if (m && m[3] === text) return `${m[1]} [${m[2] === " " ? "x" : " "}] ${m[3]}`;
					return ln;
				})
				.join("\n");
			await plugin.app.vault.modify(file, out);
			ctx.refresh();
		};

		const addNewTask = async (text: string): Promise<void> => {
			if (!text) return;
			const existing = plugin.app.vault.getAbstractFileByPath(path);
			let file: TFile;
			if (existing instanceof TFile) {
				file = existing;
			} else {
				try {
					file = await plugin.app.vault.create(path, "");
				} catch {
					return;
				}
			}
			const cur = await plugin.app.vault.read(file);
			await plugin.app.vault.modify(file, (cur ? cur + "\n" : "") + "- [ ] " + text);
			ctx.refresh();
		};

		void load();
		return {};
	},
};

export const captureType: WidgetType = {
	type: "capture",
	name: "Quick capture",
	description: "Capture a thought straight to your inbox",
	icon: "send",
	defaultSize: { w: 4, h: 2 },
	render(ctx) {
		const body = ctx.body;
		const ta = body.createEl("textarea", {
			cls: "dash-capture-input",
			attr: { placeholder: "Capture a thought…  (Enter saves, Shift+Enter new line)" },
		});
		const foot = body.createDiv("dash-capture-foot");
		const target = ctx.plugin.settings.captureTarget === "daily" ? "today's note" : ctx.plugin.settings.inboxFile;
		foot.createDiv("dash-capture-hint").setText("→ " + target);
		const btn = foot.createDiv("dash-btn dash-btn-accent");
		setIcon(btn, "send");
		btn.appendText(" Capture");

		const doCapture = async (): Promise<void> => {
			const t = ta.value.trim();
			if (!t) return;
			await ctx.plugin.captureText(t);
			ta.value = "";
		};

		btn.addEventListener("click", () => void doCapture());
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void doCapture();
			}
		});
		return {};
	},
};

export const searchType: WidgetType = {
	type: "search",
	name: "Search",
	description: "Run a global vault search",
	icon: "search",
	defaultSize: { w: 3, h: 2 },
	render(ctx) {
		const input = ctx.body.createEl("input", {
			cls: "dash-search-input",
			attr: { placeholder: "Search your vault…  (Enter)" },
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				const q = input.value.trim();
				if (q) void ctx.plugin.openSearch(q);
			}
		});
		return {};
	},
};

registerWidgetType(recentType);
registerWidgetType(tagsType);
registerWidgetType(tasksType);
registerWidgetType(captureType);
registerWidgetType(searchType);
