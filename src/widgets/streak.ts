import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { dateKey } from "../utils";

const LOOKBACK_DAYS = 800;

function shift(d: Date, days: number): Date {
	const c = new Date(d);
	c.setDate(c.getDate() + days);
	return c;
}

export const streakType: WidgetType = {
	type: "streak",
	name: "Daily streak",
	description: "Consecutive days you've written a daily note",
	icon: "calendar-check",
	defaultSize: { w: 4, h: 2 },
	render(ctx) {
		const plugin = ctx.plugin;
		const exists = (d: Date): boolean => plugin.noteExistsFor(d);

		const numEl = ctx.body.createDiv("dash-streak-num");
		const subEl = ctx.body.createDiv("dash-streak-sub");

		const renderStats = (): void => {
			const today = new Date();
			// Current streak: allow today to not be written yet.
			let cur = today;
			if (!exists(cur)) cur = shift(cur, -1);
			let streak = 0;
			while (exists(cur)) {
				streak++;
				cur = shift(cur, -1);
			}

			// Longest run within the lookback window.
			let best = 0;
			let run = 0;
			const start = shift(today, -LOOKBACK_DAYS);
			for (let d = new Date(start); d <= today; d = shift(d, 1)) {
				if (exists(d)) {
					run++;
					if (run > best) best = run;
				} else {
					run = 0;
				}
			}

			let thisWeek = 0;
			const weekStart = shift(today, -6);
			for (let d = new Date(weekStart); d <= today; d = shift(d, 1)) {
				if (exists(d)) thisWeek++;
			}

			const last = lastNoteDate(exists, today);
			numEl.setText(String(streak));
			subEl.setText(streak === 1 ? "day streak" : "days streak");
			const chips = ctx.body.createDiv("dash-hm-stats");
			chip(chips, `Best · ${best}d`, "Longest run in the last 800 days");
			chip(chips, `This week · ${thisWeek}/7`, "Daily notes in the last 7 days");
			if (last) chip(chips, `Last · ${dateKey(last)}`, "Most recent daily note");
		};

		renderStats();

		// Re-render when the day rolls over.
		let curKey = dateKey(new Date());
		const id = window.setInterval(() => {
			const k = dateKey(new Date());
			if (k !== curKey) {
				curKey = k;
				ctx.refresh();
			}
		}, 30_000);
		return { dispose: () => window.clearInterval(id) };
	},
};

function chip(parent: HTMLElement, text: string, title: string): void {
	const c = parent.createDiv("dash-hm-chip");
	c.setText(text);
	c.setAttr("title", title);
}

function lastNoteDate(exists: (d: Date) => boolean, today: Date): Date | null {
	for (let i = 0; i <= LOOKBACK_DAYS; i++) {
		const d = shift(today, -i);
		if (exists(d)) return d;
	}
	return null;
}

registerWidgetType(streakType);
