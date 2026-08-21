import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const stubUrl = pathToFileURL(new URL("./obsidian-stub.mjs", import.meta.url).pathname).href;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "obsidian") {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
