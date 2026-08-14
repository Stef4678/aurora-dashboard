require("./stub-obsidian");
const { App } = require("obsidian");
const AuroraDashboardPlugin = require("../src/main").default;
const { DashboardView } = require("../src/view");

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
