import { setIcon } from "obsidian";

export const uid = (): string =>
	Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

export const clamp = (n: number, lo: number, hi: number): number =>
	Math.max(lo, Math.min(hi, n));

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export const dateKey = (d: Date): string =>
	`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Lightweight date formatter supporting YYYY, YY, MMM, MM, ddd, DD tokens. */
export function formatDate(d: Date, fmt: string): string {
	const pad = pad2;
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	return fmt
		.replace("YYYY", String(d.getFullYear()))
		.replace("YY", String(d.getFullYear()).slice(-2))
		.replace("MMM", months[d.getMonth()])
		.replace("MM", pad(d.getMonth() + 1))
		.replace("ddd", days[d.getDay()])
		.replace("DD", pad(d.getDate()))
		.replace("dd", pad(d.getDate()));
}

export function setIconSafe(el: HTMLElement, name: string): void {
	try {
		setIcon(el, name);
	} catch {
		el.setText("·");
	}
}

export function iconInto(el: HTMLElement, cls: string, name: string): HTMLElement {
	const holder = el.createDiv({ cls });
	setIconSafe(holder, name);
	return holder;
}

export function relTime(ts: number): string {
	const diff = Date.now() - ts;
	const m = Math.floor(diff / 60000);
	if (m < 1) return "just now";
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const days = Math.floor(h / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(ts).toLocaleDateString();
}

export function startOfDay(d: Date): number {
	const c = new Date(d);
	c.setHours(0, 0, 0, 0);
	return c.getTime();
}
