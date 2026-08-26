import { execSync } from "child_process";
import fs from "fs";
import path from "path";

async function run() {
  const argToken = process.argv[2];
  const token = (
    argToken ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_PAT ||
    ""
  ).trim();

  if (!token) {
    console.error("ERROR: GITHUB_TOKEN is not set in environment variables or passed as an argument.");
    console.error("Usage: node scripts/create-pr.mjs [YOUR_GITHUB_TOKEN]");
    process.exit(1);
  }

  const repoOwner = process.env.GITHUB_OWNER || "feedlager6-coder";
  const repoName = process.env.GITHUB_REPO || "smart_logistic";
  const branchName = `feat/1c-native-agent-sync-${Date.now()}`;
  const commitMessage = "feat: 1C Enterprise native Windows Agent, auto-configured setup installer, TLS 1.2/1.3 pairing & sync";
  const prTitle = "1C:Enterprise Native Windows Agent & Seamless Cloud Pairing Integration";
  const prBody = `### Changes included in this PR:

1. **Native 1C:Enterprise Windows Agent (v3.2.0)**:
   - Built a 100% native 64-bit Windows Agent in C (\`apps/1c-agent/main.c\`) with zero external runtime dependencies (no Python or third-party interpreters needed on the client).
   - Direct 1C:Enterprise COM connection (\`V83.COMConnector\`) & CLI support for automated order export and delivery status updates.
   - Dual-engine HTTP stack using **WinHTTP** with full **TLS 1.2/1.3** protocol negotiation and automatic fallback to Windows native \`curl.exe\`.
   - Automatic local 1C infobases scanner (\`ibases.v8i\` in \`%APPDATA%\\1C\\1CEStart\`).

2. **On-The-Fly Custom Setup Installer**:
   - Backend route \`/api/integrations/1c/agent/setup.exe\` builds customized NSIS installers with pre-embedded cloud server URLs.
   - Desktop and Start Menu shortcut creation with clean uninstaller.

3. **Pairing & Synchronization Backend**:
   - Resilient pairing API (\`/api/integrations/1c/agent/pair\`) with whitespace/case cleanup and auto-registration.
   - Active pairing code auto-fetch endpoint (\`/api/integrations/1c/agent/code/active\`).
   - Detailed sync logs and connected agent heartbeat tracking.

4. **UI & UX Refinement**:
   - Clean, single-action **«Скачать установщик (.exe)»** primary button.
   - Dedicated connection parameters card with 1-click clipboard copy for Server URL and Pairing Code.
   - Live agent status monitoring and sync telemetry in the Integrations dashboard.`;

  console.log(`[1/5] Verifying repository access to ${repoOwner}/${repoName}...`);
  const repoRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "SmartRoute-Sync",
    },
  });

  if (!repoRes.ok) {
    const errorText = await repoRes.text();
    console.error(`ERROR: Failed to access repo (${repoRes.status}): ${errorText}`);
    process.exit(1);
  }

  const repoData = await repoRes.json();
  const defaultBranch = repoData.default_branch || "main";
  console.log(`Repository found! Default branch is '${defaultBranch}'.`);

  const tempDir = path.resolve("/tmp", `repo_${Date.now()}`);
  const remoteUrl = `https://x-access-token:${token}@github.com/${repoOwner}/${repoName}.git`;

  console.log(`[2/5] Cloning repository into clean temporary directory ${tempDir}...`);
  execSync(`git clone --depth 1 --branch ${defaultBranch} ${remoteUrl} ${tempDir}`);
  execSync(`git config user.name "SmartRoute Bot"`, { cwd: tempDir });
  execSync(`git config user.email "bot@smartroute.local"`, { cwd: tempDir });

  console.log("[3/5] Copying updated project files into temporary directory...");
  const srcRoot = process.cwd();
  const excludeList = new Set([
    "node_modules",
    ".git",
    "dist",
    ".cache",
    ".env",
    ".npm",
    ".turbo",
    ".next"
  ]);

  function copyDirRecursive(src, dst) {
    if (!fs.existsSync(dst)) {
      fs.mkdirSync(dst, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (excludeList.has(entry.name)) continue;
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  copyDirRecursive(srcRoot, tempDir);

  console.log(`[4/5] Creating branch '${branchName}', committing and pushing...`);
  execSync(`git checkout -b ${branchName}`, { cwd: tempDir });
  execSync("git add -A", { cwd: tempDir });
  try {
    execSync(`git commit -m "${commitMessage}"`, { cwd: tempDir });
  } catch (err) {
    console.log("Git commit output/message:", err.message);
  }
  execSync(`git push -u origin ${branchName} --force`, { cwd: tempDir });

  console.log(`[5/5] Creating Pull Request against '${defaultBranch}'...`);
  const prRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "SmartRoute-Sync",
    },
    body: JSON.stringify({
      title: prTitle,
      body: prBody,
      head: branchName,
      base: defaultBranch,
    }),
  });

  if (!prRes.ok) {
    const errorText = await prRes.text();
    console.error(`ERROR: Failed to create Pull Request (${prRes.status}): ${errorText}`);
    process.exit(1);
  }

  const prData = await prRes.json();
  console.log("\n=======================================================");
  console.log("🎉 SUCCESS: Pull Request created successfully!");
  console.log(`PR Link: ${prData.html_url}`);
  console.log(`PR Number: #${prData.number}`);
  console.log(`Branch: ${branchName} -> ${defaultBranch}`);
  console.log("=======================================================\n");

  // Cleanup temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}

run().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});
