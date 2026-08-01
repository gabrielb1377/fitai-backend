const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const blockedFileNames = [
  /(^|\/)\.env(?:\..+)?$/i,
  /(^|\/)(?:id_rsa|id_ed25519)$/i,
  /\.(?:pem|p12|pfx)$/i
];

const secretPatterns = [
  { name: "OpenAI key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i },
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  },
  {
    name: "authorization bearer",
    pattern: /\bBearer\s+[A-Za-z0-9._-]{24,}/i
  }
];

const assignmentPattern =
  /\b(OPENAI(?:_API)?_KEY|JWT_SECRET|DATABASE_URL|FIREBASE_[A-Z0-9_]*(?:KEY|SECRET)|STRIPE_[A-Z0-9_]*KEY|SUPABASE_[A-Z0-9_]*(?:KEY|URL)|GOOGLE_[A-Z0-9_]*(?:KEY|SECRET)|APPLE_[A-Z0-9_]*(?:KEY|SECRET))\b[ \t]*[:=][ \t]*["']?([^\s"']+)/gi;

function stagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { encoding: "utf8" }
  );
  return output.split(/\r?\n/).filter(Boolean);
}

function workingTreeFiles() {
  const tracked = execFileSync("git", ["ls-files", "--cached"], {
    encoding: "utf8"
  });
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { encoding: "utf8" }
  );
  return [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/).filter(Boolean))];
}

function stagedContent(file) {
  return execFileSync("git", ["show", `:${file}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
}

function workingTreeContent(file) {
  return readFileSync(file, "utf8");
}

function isText(content) {
  return !content.includes("\u0000");
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    /^(?:your|replace|change|example|placeholder|user|password|host|database|secret|troque|sua)/.test(
      normalized
    ) ||
    normalized.includes("<") ||
    normalized.includes("${") ||
    normalized.includes("localhost") ||
    normalized.includes("fitia.test") ||
    normalized.includes("local-development-secret") ||
    (/^https?:\/\//.test(normalized) && !normalized.includes("@")) ||
    /^postgres(?:ql)?:\/\/user:password@host(?::\d+)?\//.test(normalized)
  );
}

function isDynamicSourceExpression(file, value) {
  if (!/\.(?:[cm]?js|[cm]?ts|tsx?|jsx?)$/i.test(file)) return false;
  const normalized = value.trim().replace(/[),;\]}]+$/, "");
  return /^(?:process\.env(?:\.[A-Z0-9_]+|\[[^\]]+\])|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/.test(
    normalized
  );
}

function isSafeAssignmentValue(file, value) {
  const normalized = value.trim().replace(/[),;\]}]+$/, "");
  return (
    isPlaceholder(normalized) ||
    isDynamicSourceExpression(file, normalized) ||
    (/\.(?:[cm]?js|[cm]?ts|tsx?|jsx?)$/i.test(file) && normalized.length < 16)
  );
}

function scanContent(file, content) {
  const findings = [];
  if (
    blockedFileNames.some((pattern) => pattern.test(file)) &&
    file !== ".env.example"
  ) {
    findings.push("arquivo sensivel bloqueado");
  }

  for (const rule of secretPatterns) {
    if (rule.pattern.test(content)) findings.push(rule.name);
  }

  assignmentPattern.lastIndex = 0;
  for (const match of content.matchAll(assignmentPattern)) {
    if (!isSafeAssignmentValue(file, match[2])) {
      findings.push(`atribuicao de ${match[1]}`);
    }
  }
  return [...new Set(findings)];
}

function main() {
  const stagedMode = process.argv.includes("--staged");
  const files = stagedMode ? stagedFiles() : workingTreeFiles();
  const readContent = stagedMode ? stagedContent : workingTreeContent;
  const findings = [];
  for (const file of files) {
    if (file.startsWith("node_modules/")) continue;
    let content = "";
    try {
      content = readContent(file);
    } catch {
      continue;
    }
    if (!isText(content)) continue;
    for (const finding of scanContent(file, content)) {
      findings.push({ file, finding });
    }
  }

  if (findings.length === 0) return;
  console.error("Verificacao bloqueada: possivel segredo detectado.");
  for (const { file, finding } of findings) {
    console.error(`- ${file}: ${finding}`);
  }
  console.error("Remova o valor sensivel ou use um placeholder seguro antes de versionar.");
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { isPlaceholder, scanContent };
