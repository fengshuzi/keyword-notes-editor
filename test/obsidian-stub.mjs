import moment from "moment";

export { moment };
export default moment;

export class TFile {}
export class App {}
export class Component {}
export class Notice {}

export function getAllTags(cache) {
    if (!cache) return null;
    const tags = [];
    if (Array.isArray(cache.tags)) {
        for (const item of cache.tags) {
            if (item && typeof item.tag === "string") tags.push(item.tag);
        }
    }
    const frontmatter = cache.frontmatter;
    if (frontmatter) {
        const raw = frontmatter.tags;
        const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
        for (const tag of list) {
            const text = String(tag).trim();
            if (!text) continue;
            tags.push(text.startsWith("#") ? text : `#${text}`);
        }
    }
    return tags.length > 0 ? tags : null;
}
