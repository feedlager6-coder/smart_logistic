import { execSync } from "child_process";

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

  console.log("[2/5] Preparing git workspace and commits...");
  execSync('git config --global user.name "SmartRoute Bot" || true');
  execSync('git config --global user.email "bot@smartroute.local" || true');

  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  } catch {
    execSync("git init");
  }

  const remoteUrl = `https://x-access-token:${token}@github.com/${repoOwner}/${repoName}.git`;
  try {
    execSync("git remote remove origin", { stdio: "ignore" });
  } catch {}
  execSync(`git remote add origin ${remoteUrl}`);

  console.log(`[3/5] Fetching remote branch ${defaultBranch}...`);
  try {
    execSync(`git fetch origin ${defaultBranch}`);
  } catch (err) {
    console.warn("Could not fetch remote branch:", err);
  }

  execSync(`git checkout -B ${branchName}`);
  try {
    execSync(`git reset --mixed origin/${defaultBranch}`);
  } catch (err) {
    console.warn("Could not mixed-reset to origin:", err);
  }
  execSync("git add -A");

  try {
    execSync(`git commit -m "${commitMessage}"`);
  } catch (err) {
    console.log("Commit message or error:", err.message);
  }

  console.log(`[4/5] Pushing branch '${branchName}' to GitHub...`);
  execSync(`git push -u origin ${branchName} --force`);

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
      head: branchName,
      base: defaultBranch,
      body: prBody,
    }),
  });

  const prData = await prRes.json();
  if (!prRes.ok) {
    console.error(`Failed to create PR (${prRes.status}):`, JSON.stringify(prData, null, 2));
    process.exit(1);
  }

  console.log(`\n🎉 SUCCESS! Pull Request created successfully:`);
  console.log(prData.html_url);
}

run().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});
