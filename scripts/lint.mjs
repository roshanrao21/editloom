import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ignored = new Set([".git", "node_modules", "coverage"]);

function collectJavaScript(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ignored.has(entry.name) ? [] : collectJavaScript(path);
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  });
}

const files = collectJavaScript("apps").concat(collectJavaScript("packages"));
for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });

const trackedSecrets = execFileSync("git", ["ls-files", ".env", ".env.local"], { encoding: "utf8" }).trim();
if (trackedSecrets) throw new Error("Local secret files must not be tracked");

console.info(`Lint passed for ${files.length} JavaScript files.`);
