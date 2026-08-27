# Changelog

## 1.0.24

- Add `🔖 行关键词` sidebar view: scan configured journal folders for list lines such as `- #cy 餐饮 90`, aggregate `cy+gw` / `cy,gw`, match nested tags, skip code blocks, and group results into date cards
- Line-keyword cards are read-only extracts; clicking the date or double-clicking content opens the complete journal note for normal editing

## 1.0.23

- Fix: Xiaohongshu/folder views no longer treat newly created non-markdown files (images, PDFs) as notes
- Add unit test suite (`npm test`) covering file collection, Xiaohongshu card parsing, Cornell parsing, and themes

## 1.0.22

- Add Cornell note view and Xiaohongshu image-text card view
- Sidebar entries support directory-based Xiaohongshu browsing with 3:4 card pagination

## 1.0.0

- Initial release: keyword-based note viewing and editing
- Tag and folder selection modes
- Sub-tag tree support with collapsible hierarchy
- Infinite scroll for large note collections
- Collapsible note editors
- Custom date range filtering
- Preset management for saved views
- Left sidebar keyword list with tree navigation
- Up/Down arrow navigation between notes
