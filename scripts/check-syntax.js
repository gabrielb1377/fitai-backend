const { readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const roots = [join(process.cwd(), "src"), join(process.cwd(), "tests")];
const files = roots.flatMap(listJavaScriptFiles);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.info(`[check] ${files.length} arquivos JavaScript verificados.`);

function listJavaScriptFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const location = join(directory, entry);
    if (statSync(location).isDirectory()) return listJavaScriptFiles(location);
    return location.endsWith(".js") ? [location] : [];
  });
}
