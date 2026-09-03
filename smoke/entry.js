require("./stub-obsidian");
const { App } = require("obsidian");
const AuroraDashboardPlugin = require("../src/main").default;
const { DashboardView } = require("../src/view");
const { getWidgetTypes } = require("../src/registry");

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const dateKeyNow = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function main() {
	const app = new App();
	await app.vault.create("Notes/Alpha.md", "# Alpha\nhello world");
	await app.vault.create("Notes/Beta.md", "# Beta\nanother note");

	const plugin = new AuroraDashboardPlugin(app, { id: "aurora-dashboard" });
	await plugin.onload();

	const leaf = app.workspace.getLeaf(false);
	const view = new DashboardView(leaf, plugin);
	leaf.view = view;
	await view.onOpen();

	const content = view.contentEl;
	const errors = [];
	content.querySelectorAll(".dash-widget-error").forEach((e) => errors.push(e.textContent));

	const checks = {};
	checks.widgetCount = content.querySelectorAll(".dash-widget").length;
	const layoutTypes = plugin.settings.layout.map((i) => i.type).sort();
	const regTypes = getWidgetTypes().map((t) => t.type).sort();
	checks.allWidgetTypesInDefaultLayout = layoutTypes.join(",") === regTypes.join(",");
	checks.hasControlCenter = content.textContent.includes("Control Center");
	checks.hasClock = !!content.querySelector(".dash-clock-time");
	checks.hasCalendar = !!content.querySelector(".dash-cal-grid");
	checks.hasHeatmap = !!content.querySelector(".dash-heatmap");
	checks.hasStats = !!content.querySelector(".dash-stat-row");
	checks.hasRecent = !!content.querySelector(".dash-list");
	checks.hasTasks = !!content.querySelector(".dash-add-row");
	checks.hasCapture = !!content.querySelector(".dash-capture-input");
	checks.hasPomodoro = !!content.querySelector(".dash-pomo-ring");
	checks.hasQuote = !!content.querySelector(".dash-quote-text");
	checks.renderErrors = errors;

	plugin.addWidget("search");
	checks.widgetCountAfterAdd = content.querySelectorAll(".dash-widget").length;

	await app.vault.modify(app.vault.getAbstractFileByPath("Notes/Alpha.md"), "# Alpha\nmore words");
	checks.activityRecorded = (plugin.settings.activity[dateKeyNow()] || 0) > 0;

	await plugin.captureText("hello from smoke test");
	const inbox = app.vault.getAbstractFileByPath("Inbox.md");
	checks.inboxCreated = !!inbox;
	checks.inboxContent = inbox ? (await app.vault.read(inbox)).includes("hello from smoke test") : false;

	await plugin.openDay(new Date());
	const todayPath = plugin.dailyNotePath(new Date());
	const todayFile = app.vault.getAbstractFileByPath(todayPath);
	checks.todayNoteCreated = !!todayFile;
	if (todayFile) {
		await app.vault.modify(todayFile, "- [ ] Write the report\n- [x] Done item");
		plugin.refreshActivityWidgets();
		await tick(30);
		const taskCheck = content.querySelector(".dash-task .dash-check");
		checks.tasksRendered = !!taskCheck;
		if (taskCheck) {
			taskCheck.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(30);
			const text = await app.vault.read(todayFile);
			checks.taskToggled = text.includes("- [x] Write the report");
		}
	}

	plugin.settings.editMode = true;
	plugin.rerenderDashboard();
	checks.editingClass = content.classList.contains("editing");
	checks.gripPresent = !!content.querySelector(".dash-grip");
	checks.resizeHandlePresent = !!content.querySelector(".dash-resize");

	const collapseBtn = content.querySelector(".dash-widget:not(.no-header) .dash-widget-collapse");
	if (collapseBtn) {
		collapseBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(30);
		checks.collapseApplies = !!content.querySelector(".dash-widget.collapsed");
		const expandBtn = content.querySelector(".dash-widget.collapsed .dash-widget-collapse");
		if (expandBtn) {
			expandBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(30);
		}
		checks.collapseReopens = !content.querySelector(".dash-widget.collapsed");
	} else {
		checks.collapseApplies = false;
		checks.collapseReopens = false;
	}

	const cancelBtn = content.querySelector('.dash-control-right .dash-btn[aria-label="Cancel editing"]');
	if (cancelBtn) {
		cancelBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(30);
		checks.cancelExitsEditMode = !content.classList.contains("editing") && plugin.settings.editMode === false;
	} else {
		checks.cancelExitsEditMode = false;
	}

	plugin.addWidget("deadline");
	checks.deadlineRenders = !!content.querySelector(".dash-deadline-days");
	const dlInst = plugin.settings.layout.find((i) => i.type === "deadline");
	if (dlInst) {
		dlInst.settings.date = "2099-01-01";
		plugin.refreshWidget(dlInst.uid);
		await tick(30);
		const dlDays = content.querySelector(".dash-deadline-days");
		checks.deadlineCountdown = dlDays ? /^\d+$/.test(dlDays.textContent.trim()) : false;
		dlInst.settings.date = "2000-01-01";
		plugin.refreshWidget(dlInst.uid);
		await tick(30);
		checks.deadlineOverdue = !!content.querySelector(".dash-deadline-days.overdue");
	} else {
		checks.deadlineCountdown = false;
		checks.deadlineOverdue = false;
	}

	plugin.addWidget("random");
	const randomBtn = content.querySelector(".dash-random-btn");
	checks.randomRenders = !!randomBtn;
	const openedLog = [];
	const origOpenFile = plugin.openFile;
	plugin.openFile = (f) => {
		openedLog.push(f);
	};
	if (randomBtn) {
		randomBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(30);
	}
	plugin.openFile = origOpenFile;
	checks.randomOpensNote = openedLog.length === 1 && !!openedLog[0] && openedLog[0].extension === "md";

	// vault-wide tasks widget — reset the daily note so it has an open task to find
	const vtf = app.vault.getAbstractFileByPath(plugin.dailyNotePath(new Date()));
	if (vtf) await app.vault.modify(vtf, "- [ ] Plan the weekend\n- [x] Already done");
	plugin.addWidget("vaulttasks");
	await tick(60);
	const vtWidget = content.querySelector(".widget-vaulttasks");
	checks.vaultTasksWidget = !!vtWidget;
	checks.vaultTasksRows = vtWidget ? vtWidget.querySelectorAll(".dash-list-row").length > 0 : false;
	const vtCheck = vtWidget ? vtWidget.querySelector(".dash-list-row .dash-check") : null;
	checks.vaultTasksCheckbox = !!vtCheck;
	if (vtCheck) {
		vtCheck.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(30);
		checks.vaultTaskToggled = vtf ? (await app.vault.read(vtf)).includes("- [x] Plan the weekend") : false;
	}

	// quick actions widget
	plugin.addWidget("quickactions");
	await tick(30);
	const qaWidget = content.querySelector(".widget-quickactions");
	checks.quickActionsWidget = !!qaWidget;
	checks.quickActionsButtons = qaWidget ? qaWidget.querySelectorAll(".dash-quick-btn").length > 0 : false;

	// link/streak widgets (part of the default layout)
	checks.hasPopular = !!content.querySelector(".widget-popular");
	checks.hasOrphans = !!content.querySelector(".widget-orphans");
	checks.hasBacklinks = !!content.querySelector(".widget-backlinks");
	checks.hasPinned = !!content.querySelector(".widget-pinned");
	checks.hasProgress = !!content.querySelector(".dash-prog-ring");
	checks.hasStreak = !!content.querySelector(".dash-streak-num");
	checks.newWidgetErrors = errors;

	checks.settingsSaved = await plugin.saveSettings().then(() => true).catch(() => false);

	const failed = Object.entries(checks).filter(
		([, v]) => v === false || v === undefined || (Array.isArray(v) && v.length > 0)
	);
	console.log("SMOKE CHECKS:\n" + JSON.stringify(checks, null, 2));
	if (failed.length) {
		console.error("FAILED CHECKS:", JSON.stringify(failed));
		process.exit(1);
	}
	console.log("SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((e) => {
	console.error("SMOKE TEST ERROR:", e);
	process.exit(1);
});
