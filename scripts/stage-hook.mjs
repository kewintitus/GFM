import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const source = existsSync("hooks/commit-msg") ? "hooks/commit-msg" : "hooks/commit-msg.disabled";
await mkdir(".pack/hooks", { recursive: true });
await copyFile(source, ".pack/hooks/commit-msg");
