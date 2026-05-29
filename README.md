# Keyword Notes Editor

Organize your sidebar by keyword tags and folder paths, then view and edit all matching notes in a single scrollable view. Supports multi-level sub-tag trees.

## Core Features

**Keyword Sidebar** — the plugin adds a navigation list for each configured keyword and folder in the left sidebar:

- Click a keyword to display all notes with that tag in the editor area
- **Multi-level sub-tags** expand in a tree hierarchy (e.g. `test/work/meeting` auto-nests by level)
- **Tag aggregation** — combine multiple tags (e.g. `p1+p2+p3|quadrant`) so notes matching any one of them are included
- Click a folder path to display all markdown files under that directory

**Batch Browsing & Editing** — all matching notes appear together in one scrollable view, no need to open individual tabs.

## Highlights

- 📋 **Keyword Sidebar** — keyword/folder navigation with collapsible sub-tag tree
- 🏷️ **Tag Query** — pull all notes matching a tag, including nested sub-tags
- 📁 **Folder Query** — pull all notes under a given folder path
- 🔗 **Multi-Tag Aggregation** — configure a group of tags, hit any one to show the note
- ⏰ **Time Filter** — filter by week, month, quarter, or custom date range
- ⬇️⬆️ **Collapse / Expand All** — fold or unfold every note at once
- ⌨️ **Keyboard Navigation** — jump between notes with Arrow Up / Arrow Down
- 📜 **Infinite Scroll** — lazy-loads notes as you scroll for smooth performance

## Installation

### Obsidian Community Plugins (recommended)

Open Obsidian Settings → Community Plugins → Browse, search for **Keyword Notes Editor** or **fengshuzi**.

### GitHub Release

1. Download the latest `main.js`, `manifest.json`, `styles.css` from [Releases](../../releases)
2. Place them in `.obsidian/plugins/keyword-notes-editor/`
3. Restart Obsidian and enable the plugin

### Manual

```bash
cd /path/to/your/vault/.obsidian/plugins
git clone https://github.com/fengshuzi/keyword-notes-editor.git
cd keyword-notes-editor
npm install
npm run build
```

## Usage

### Configure Keywords & Folders

Edit keyword and folder configs in the plugin settings:

**Keyword format**: `tag|alias|icon`

```
work|Work|💼,project|Projects|📋
```

**Aggregation mode** (notes matching any of the tags are included):

```
p1+p2+p3+p4|Quadrant
```

**Folder format**: `path|alias|icon`

```
projects/work|Work Projects|📁,archive|Archive|🗄️
```

### Using the Sidebar

- After saving config, keywords and folders appear in the left sidebar
- Click any entry to show all matching notes in the editor area
- Keywords with sub-tags (e.g. `test` has children like `test/work`, `test/work/meeting`) show an expandable arrow — browse hierarchically
- Click a leaf sub-tag to show only notes with that specific sub-tag

### Time Filter

Click the calendar icon in the top-right toolbar to filter notes by week, month, year, quarter, or a custom date range.

### Keyboard Navigation

Use ↑ / ↓ inside the editor to quickly move between notes.

## Settings

- **Hide frontmatter** / **Hide backlinks** — keep the editing view clean
- **Open keyword list on startup** — auto-open the sidebar on plugin load
- **Use Arrow Up/Down to navigate** — enable keyboard hopping between notes

## Development

```bash
npm run dev      # watch mode
npm run build    # production build
npm run deploy   # push to local vaults
npm run release  # publish to GitHub
```

## Credits

- [Hover Editor](https://github.com/nothingislost/obsidian-hover-editor) — workspace leaf spawning code

## License

MIT

---

## ☕ Buy Me a Coffee

If this plugin helps you, feel free to support with a donation. Thank you!

<div align="center">
  <img src="./assets/wechat-donate.jpg" alt="WeChat Donate" width="200" />
  <p><sub>Scan with WeChat</sub></p>
</div>
