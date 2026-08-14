# Aurora Dashboard

A polished, interactive dashboard and control center for [Obsidian](https://obsidian.md) — a grid of draggable, resizable widgets covering your clock, calendar, activity, tasks, capture, and more.

## Features

- **Draggable, resizable widgets** on a configurable grid — set columns, row height, and gap to taste
- **Edit mode** — drag, resize, remove, and re-configure widgets, or reset the layout in one click
- **Activity tracking** — a GitHub-style heatmap of your note edits, with streaks, weekly, and lifetime totals
- **Daily note integration** — the calendar and Today widgets open, create, and manage your daily notes
- **Quick capture** — send a thought to your inbox file or today's note in one keystroke
- **Custom accent color** — theme the highlights, charts, and progress rings (with presets)
- **Fully offline** — all data lives in your vault, no external services

## Widgets

| Widget | Description |
| --- | --- |
| **Clock** | Live digital clock with the current date; toggle seconds and 24-hour format |
| **Calendar** | Month view with a dot on days that have a daily note; click a day to open or create it |
| **Activity** | GitHub-style heatmap of your editing activity, plus streak, weekly, and total stats |
| **Notes** | Vault stats at a glance — note count, created today, edits this week, 7-day sparkline |
| **Recent** | Notes you touched recently, click to open |
| **Tags** | Your most-used tags, click to run a vault search |
| **Today** | Checkboxes from today's daily note — check them off or add new tasks inline |
| **Quick capture** | A textarea that appends to your inbox file or today's note |
| **Search** | Global vault search right from the dashboard |
| **Pomodoro** | A focus timer with an animated ring; configurable focus/break lengths |
| **Quote** | A rotating dose of inspiration |

## Installation

The plugin isn't on the community plugin list yet. To use it:

1. Build it (`npm run build`) or download a release.
2. Copy the `aurora-dashboard` folder into `<your-vault>/.obsidian/plugins/`.
3. Restart Obsidian, then enable **Aurora Dashboard** under *Settings → Community plugins*.
4. Open it from the ribbon icon, or with `Ctrl/Cmd + Shift + D`.

## Usage

- **Open the dashboard** — ribbon icon, `Ctrl/Cmd + Shift + D`, or the command palette.
- **Edit the layout** — click the pencil button in the dashboard's control bar (or run *Toggle dashboard edit mode*). Drag widgets by their grip, resize from the corner, use the gear for per-widget settings, the ✕ to remove, and the **+** to add new widgets.
- **Quick capture** — the *Capture to inbox* command, or the send button in the control bar.
- **Search** — the search button in the control bar, or the Search widget.

## Settings

All options live under *Settings → Aurora Dashboard*:

- **Layout** — columns, row height, gap, edit mode, reset layout
- **Appearance** — accent color with a picker and one-click presets
- **Activity** — toggle note-edit tracking and clear collected data
- **Daily notes** — folder and filename format (tokens: `YYYY`, `YY`, `MMM`, `MM`, `DD`, `ddd`)
- **Capture** — target (inbox file vs today's note), folder, and inbox filename
- **Pomodoro** — default focus/break lengths used by new Pomodoro widgets

## Development

```bash
npm install
npm run dev        # watch mode, bundles to main.js
npm run build      # typecheck (tsc --noEmit) + production bundle
```

Smoke test — renders the dashboard in jsdom and runs assertions against every widget:

```bash
node smoke/build.mjs   # bundle the smoke test
node smoke/out.js      # run the checks (exit 0 = pass)
```

## How it works

- `src/registry.ts` — widget type registration
- `src/layout.ts` — grid layout, collision detection, and overlap resolution
- `src/widgets/*.ts` — each widget is a self-contained module with a `render` function
- `src/view.ts` — the dashboard view: grid, drag/resize, edit mode, modals
- `src/main.ts` — plugin lifecycle, settings, commands, and activity tracking

## License

MIT
