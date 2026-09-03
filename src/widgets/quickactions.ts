import { Modal, Notice, setIcon, TFile, normalizePath, type App } from "obsidian";
import type { DashboardPlugin, WidgetInstance, WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { pad2 } from "../utils";

type ActionKind = "command" | "note" | "search" | "today" | "capture" | "template";

interface QuickAction {
	id: string;
	label: string;
	kind: ActionKind;
	target: string;
}

const KIND_ICON: Record<ActionKind, string> = {
	command: "terminal",
	note: "file-text",
	search: "search",
	today: "calendar",
	capture: "send",
	template: "file-plus",
};

const KIND_LABEL: Record<ActionKind, string> = {
	command: "Command",
	note: "Open note",
	search: "Search",
	today: "Today's note",
	capture: "Quick capture",
	template: "New note from template",
};

function defaultAction(kind: ActionKind): QuickAction {
	return {
		id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
		label: kind === "command" ? "Run command" : KIND_LABEL[kind].split(" ")[0],
		kind,
		target: "",
	};
}

function defaultActions(): QuickAction[] {
	return [
		{ id: uid(), label: "Capture", kind: "capture", target: "" },
		{ id: uid(), label: "Search", kind: "search", target: "" },
		{ id: uid(), label: "Today", kind: "today", target: "" },
	];
}

function uid(): string {
	return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

async function dispatch(plugin: DashboardPlugin, a: QuickAction): Promise<void> {
	const app = plugin.app;
	switch (a.kind) {
		case "capture":
			plugin.showQuickCapture();
			break;
		case "today":
			await plugin.openDay(new Date());
			break;
		case "search":
			await plugin.openSearch(a.target.trim());
			break;
		case "note": {
			const f = app.vault.getAbstractFileByPath(a.target.trim());
			if (f instanceof TFile) plugin.openFile(f);
			else new Notice("Note not found: " + a.target);
			break;
		}
		case "command": {
			const id = a.target.trim();
			if (!id) {
				new Notice("No command selected.");
				break;
			}
			try {
				const cmds = (app as unknown as { commands?: { executeCommandById?: (id: string) => Promise<void> | void } })
					.commands;
				await cmds?.executeCommandById?.(id);
			} catch {
				new Notice("Couldn't run command: " + id);
			}
			break;
		}
		case "template": {
			const tpl = app.vault.getAbstractFileByPath(a.target.trim());
			if (!(tpl instanceof TFile)) {
				new Notice("Template not found: " + a.target);
				break;
			}
			try {
				const content = await app.vault.read(tpl);
				const d = new Date();
				const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
					d.getHours()
				)}${pad2(d.getMinutes())}`;
				const name = stamp.replace(/ /g, "-") + ".md";
				const slash = tpl.path.lastIndexOf("/");
				const dir = slash > 0 ? tpl.path.slice(0, slash) : "";
				const newPath = normalizePath(dir ? dir + "/" + name : name);
				const f = await app.vault.create(newPath, content);
				plugin.openFile(f);
				new Notice("Created " + f.basename);
			} catch {
				new Notice("Couldn't create note from template.");
			}
			break;
		}
	}
}

const actionType: WidgetType = {
	type: "quickactions",
	name: "Quick actions",
	description: "Configurable buttons that run commands, open notes, or insert templates",
	icon: "zap",
	defaultSize: { w: 3, h: 2 },
	defaultSettings: { actions: defaultActions() },
	openSettings(plugin, inst) {
		new QuickActionsModal(plugin.app, plugin, inst).open();
	},
	render(ctx) {
		const actions = (Array.isArray(ctx.inst.settings.actions) ? ctx.inst.settings.actions : defaultActions()) as QuickAction[];
		const grid = ctx.body.createDiv("dash-quick-grid");
		if (!actions.length) {
			grid.createDiv("dash-empty").setText("No quick actions — edit in settings");
			return {};
		}
		for (const a of actions) {
			const btn = grid.createDiv("dash-quick-btn");
			const icon = btn.createDiv("dash-quick-icon");
			setIcon(icon, KIND_ICON[a.kind] ?? "zap");
			btn.createDiv("dash-quick-label").setText(a.label);
			btn.addEventListener("click", () => void dispatch(ctx.plugin, a));
		}
		return {};
	},
};

class QuickActionsModal extends Modal {
	plugin: DashboardPlugin;
	inst: WidgetInstance;
	private actions: QuickAction[];

	constructor(app: App, plugin: DashboardPlugin, inst: WidgetInstance) {
		super(app);
		this.plugin = plugin;
		this.inst = inst;
		this.actions = (Array.isArray(inst.settings.actions) ? inst.settings.actions : defaultActions()).map((a) =>
			JSON.parse(JSON.stringify(a))
		) as QuickAction[];
	}

	onOpen(): void {
		this.titleEl.setText("Quick actions — settings");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const list = contentEl.createDiv("dash-qa-list");
		for (const a of this.actions) this.renderRow(list, a);
		if (!this.actions.length) list.createDiv("dash-empty").setText("No actions yet — add one.");
		contentEl.createDiv("dash-modal-foot", (foot) => {
			const add = foot.createDiv("dash-btn dash-btn-accent");
			setIcon(add, "plus");
			add.appendText(" Add action");
			add.addEventListener("click", () => {
				this.actions.push(defaultAction("command"));
				this.render();
			});
			const done = foot.createDiv("dash-btn dash-btn-ghost");
			done.appendText("Done");
			done.addEventListener("click", () => void this.commit());
		});
	}

	private renderRow(container: HTMLElement, a: QuickAction): void {
		const row = container.createDiv("dash-qa-row");

		const label = row.createEl("input", { cls: "dash-qa-input", attr: { placeholder: "Label" } });
		label.value = a.label;
		label.addEventListener("input", () => (a.label = label.value));

		const kindSel = row.createEl("select", { cls: "dash-qa-select" });
		for (const k of Object.keys(KIND_LABEL) as ActionKind[]) {
			const opt = kindSel.createEl("option");
			opt.value = k;
			opt.text = KIND_LABEL[k];
			if (k === a.kind) opt.selected = true;
		}
		kindSel.addEventListener("change", () => {
			a.kind = kindSel.value as ActionKind;
			this.render();
		});

		const target = row.createEl("input", { cls: "dash-qa-input", attr: { placeholder: this.placeholderFor(a.kind) } });
		target.value = a.target;
		target.addEventListener("input", () => (a.target = target.value));
		const needsTarget = a.kind === "command" || a.kind === "note" || a.kind === "search" || a.kind === "template";
		target.style.display = needsTarget ? "" : "none";
		if (a.kind === "command") this.fillCommandDataslist(target);

		const del = row.createDiv("dash-btn dash-btn-danger");
		setIcon(del, "x");
		del.setAttr("aria-label", "Remove action");
		del.addEventListener("click", () => {
			this.actions = this.actions.filter((x) => x.id !== a.id);
			this.render();
		});
	}

	private placeholderFor(kind: ActionKind): string {
		switch (kind) {
			case "command":
				return "Command id (e.g. app:new-note)";
			case "note":
				return "Note path (e.g. Projects/Plan.md)";
			case "search":
				return "Search query";
			case "template":
				return "Template path (e.g. Templates/Weekly.md)";
			default:
				return "";
		}
	}

	private fillCommandDataslist(target: HTMLInputElement): void {
		const commands = (this.app as App & { commands?: { listCommands?: () => { id: string; name: string }[] } }).commands;
		const id = "dash-qa-commands";
		let dl = document.getElementById(id) as HTMLDataListElement | null;
		if (!dl) {
			dl = document.createElement("datalist");
			dl.id = id;
			document.body.appendChild(dl);
		}
		if (!dl.childElementCount) {
			const cmds = commands?.listCommands?.() ?? [];
			for (const c of cmds) {
				const opt = document.createElement("option");
				opt.value = c.id;
				opt.label = c.name;
				dl.appendChild(opt);
			}
		}
		target.setAttribute("list", id);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async commit(): Promise<void> {
		this.inst.settings.actions = this.actions.map((a) => JSON.parse(JSON.stringify(a)));
		await this.plugin.saveSettings();
		this.plugin.refreshWidget(this.inst.uid);
		this.close();
	}
}

registerWidgetType(actionType);
