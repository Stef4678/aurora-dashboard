import type { WidgetInstance, WidgetSize } from "./types";
import { uid } from "./utils";

export interface Pos {
	x: number;
	y: number;
}

export function overlaps(a: WidgetInstance, b: WidgetInstance): boolean {
	return (
		a.x < b.x + b.w &&
		a.x + a.w > b.x &&
		a.y < b.y + b.h &&
		a.y + a.h > b.y
	);
}

export function hasOverlap(layout: WidgetInstance[], inst: WidgetInstance): boolean {
	return layout.some((o) => o.uid !== inst.uid && overlaps(inst, o));
}

export function gridRows(layout: WidgetInstance[]): number {
	let m = 1;
	for (const i of layout) m = Math.max(m, i.y + i.h);
	return m;
}

export function fitsAt(
	layout: WidgetInstance[],
	inst: WidgetInstance,
	x: number,
	y: number,
	columns: number
): boolean {
	if (x < 0 || y < 0 || x + inst.w > columns) return false;
	const old = { x: inst.x, y: inst.y };
	inst.x = x;
	inst.y = y;
	const ok = !hasOverlap(layout, inst);
	inst.x = old.x;
	inst.y = old.y;
	return ok;
}

export function nearestFree(
	layout: WidgetInstance[],
	inst: WidgetInstance,
	targetX: number,
	targetY: number,
	columns: number
): Pos {
	const maxY = Math.max(gridRows(layout), targetY) + 6;
	let best: Pos | null = null;
	let bestD = Infinity;
	for (let y = 0; y <= maxY; y++) {
		for (let x = 0; x < columns; x++) {
			if (fitsAt(layout, inst, x, y, columns)) {
				const d = (x - targetX) ** 2 + (y - targetY) ** 2;
				if (d < bestD) {
					bestD = d;
					best = { x, y };
				}
			}
		}
	}
	return best ?? { x: 0, y: maxY };
}

export function findFirstFree(
	layout: WidgetInstance[],
	size: WidgetSize,
	columns: number
): Pos {
	for (let y = 0; y <= gridRows(layout) + 1; y++) {
		for (let x = 0; x < columns; x++) {
			if (x + size.w > columns) continue;
			const probe = makeProbe(size, x, y);
			if (!hasOverlap(layout, probe)) return { x, y };
		}
	}
	return { x: 0, y: gridRows(layout) + 1 };
}

function makeProbe(size: WidgetSize, x: number, y: number): WidgetInstance {
	return {
		type: "",
		uid: uid(),
		x,
		y,
		w: size.w,
		h: size.h,
		settings: {},
	};
}

/** Resolve overlaps by anchoring earlier widgets in the array and moving later ones down. */
export function resolveOverlaps(layout: WidgetInstance[], columns: number): void {
	for (let i = 0; i < layout.length; i++) {
		const inst = layout[i];
		let guard = 0;
		while (hasOverlap(layout.slice(0, i), inst) && guard < 50) {
			const pos = nearestFree(layout.slice(0, i), inst, inst.x, inst.y + 1, columns);
			inst.x = pos.x;
			inst.y = pos.y;
			guard++;
		}
	}
}

export interface LayoutItem {
	type: string;
	x: number;
	y: number;
	w: number;
	h: number;
	settings?: Record<string, unknown>;
	title?: string;
}

export function makeLayout(items: LayoutItem[]): WidgetInstance[] {
	return items.map((i) => ({
		type: i.type,
		uid: uid(),
		x: i.x,
		y: i.y,
		w: i.w,
		h: i.h,
		settings: i.settings ?? {},
		title: i.title,
	}));
}

export function defaultLayout(): WidgetInstance[] {
	return makeLayout([
		{ type: "clock", x: 0, y: 0, w: 4, h: 2 },
		{ type: "calendar", x: 4, y: 0, w: 5, h: 4 },
		{ type: "activity", x: 9, y: 0, w: 3, h: 4 },
		{ type: "stats", x: 0, y: 2, w: 4, h: 2 },
		{ type: "tasks", x: 0, y: 4, w: 4, h: 3 },
		{ type: "recent", x: 4, y: 4, w: 5, h: 3 },
		{ type: "tags", x: 9, y: 4, w: 3, h: 3 },
		{ type: "capture", x: 0, y: 7, w: 4, h: 2 },
		{ type: "pomodoro", x: 4, y: 7, w: 3, h: 2 },
		{ type: "quote", x: 7, y: 7, w: 5, h: 2 },
		{ type: "deadline", x: 0, y: 9, w: 3, h: 2 },
	]);
}
