import pkg from "../package.json" with { type: "json" };

/** The single source of truth for the CLI version, bundled into the binary. */
export const VERSION: string = pkg.version;
