import { execSync } from "child_process";
import fs from "fs";
import path from "path";

async function run() {
  const token = (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_PAT ||
    ""
  ).trim();

  if (!token) {
    console.error("ERROR: GITHUB_TOKEN is not set in environment variables.");
    process.exit(1);
  }

  const repoOwner = "feedlager6-coder";
  const repoName = "smart_logistic";
  const branchName = `fix/telegram-driver-integration-${Date.now()}`;
  const commitMessage = "feat: fix Telegram driver connection, phone number linking, and route broadcasting";
  const prTitle = "Fix Telegram driver connection and route broadcasting";
  const prBody = `### Changes included in this PR:
1. **Telegram Driver Link Integration**:
   - Fixed \`/start <token>\` authentication workflow for driver registration via Telegram bot.
   - Added automatic resolution of Bot username via Telegram API.
   - Added instant dispatch of active route assignments upon driver registration.

2. **Phone Number & Contact Registration**:
   - Added support for Telegram \`request_contact\` button to link drivers by shared contact.
   - Added plain-text phone number recognition (e.g. \`+7 928 ...\`) with 10-digit normalization.

3. **Route Broadcast & Dispatching**:
   - Fixed Telegram message formatting and URL validation for driver web-app links.
   - Handled inline buttons with graceful fallback to prevent Telegram API \`BUTTON_URL_INVALID\` errors.
   - Added detailed dispatch status and error reporting for unlinked drivers.

4. **Background Polling & Webhook**:
   - Added automatic background polling fallback for Telegram Bot updates.`;

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
  const excludeList = new Set(["node_modules", ".git", "dist", ".cache", ".env", ".npm", ".turbo", ".next"]);

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
