# AGENTS.md — keyword-notes-editor

Obsidian plugin that views and edits multiple notes grouped by keyword tags, similar to Logseq tag view. Built with Svelte + Vite.

## Layout

- `src/` — Svelte components and TypeScript source
  - `src/keywordNotesPlugin.ts` — plugin entry point
- `manifest.json` / `versions.json` / `vite.config.mjs` / `eslint.config.mjs` / `tsconfig.json`
- `deploy.mjs` / `release.mjs` / `version-bump.mjs` — maintainer scripts
- `ARCHITECTURE.md` / `CHANGELOG.md` — documentation

## Commands

```bash
npm run dev      # lint + vite build --watch --mode development
npm run build    # lint + svelte-check + vite build --mode production + cp manifest.json dist/
npm run lint     # eslint "**/*.{ts,tsx}" (includes Svelte files)
npm run deploy   # build + copy to author's local vaults, then delete dist/
npm run release  # gh release create from manifest.json version
npm run version  # bump version + git add manifest.json versions.json
```

`build` enforces lint + `svelte-check` before Vite bundling.

## Build

- **Svelte + Vite** (not esbuild)
- Vite lib mode, format `cjs`, output `dist/main.js` + `dist/styles.css`
- Entry: `src/keywordNotesPlugin.ts`
- Copies `manifest.json` to `dist/` after build
- Dependencies: `@codemirror/state`, `@codemirror/view`, `monkey-around` (bundled)

## Architecture

- Svelte 4 components in `src/`
- Uses `svelte-inview` for lazy loading
- `@codemirror/state` and `@codemirror/view` for editor integration
- See `ARCHITECTURE.md` for detailed component structure

## Lint

ESLint covers `*.ts` and `*.svelte` files. `svelte-check` runs as a separate typecheck step during build.

## Versioning

- `version-bump.mjs` bumps `manifest.json` and `versions.json` automatically
- `release.mjs` reads version from `manifest.json`
- Keep `package.json` in sync manually

## Marketplace / Scorecard

Marketplace, manifest, and release conventions live in the parent `obsidian-plugins-parent/AGENTS.md`. Read it before touching `manifest.json`, release flow, or marketplace-facing code.