#!/usr/bin/env node
/**
 * ARGUS Product Manager (PM) Agent — Autonomous Headless Audit Runner
 *
 * Designed to run in GitHub Actions (as `github-actions[bot]`) or locally via CLI.
 * Executes the 4-step PM Agent workflow defined in `.agents/skills/pm-agent/SKILL.md`:
 *   1. Inspects open/closed GitHub issues, Miro Kanban tasks, and recent commits.
 *   2. Reconciles unlinked open GitHub issues onto the Miro Kanban board.
 *   3. Audits `specs/03-requirements.md` (`REQ-01`–`REQ-10`) against `src/` using Gemini
 *      structured JSON output (`@google/genai`).
 *   4. Closes resolved GitHub issues (+ marks Miro cards `done`) and opens concise
 *      new `[PM Agent]` issues (+ creates linked Miro `todo` cards) while enforcing
 *      the 5-open-issue anti-spam guardrail.
 *
 * Usage:
 *   node .agents/skills/pm-agent/scripts/run-pm-audit.mjs [--dry-run] [--max-new <n>]
 */

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const ISSUES_DIR = path.resolve(SKILL_DIR, 'issues');
const REPO_ROOT = path.resolve(SKILL_DIR, '../../..');
const GH_SCRIPT = path.resolve(SCRIPT_DIR, 'gh-pm-issue.mjs');
const MIRO_SCRIPT = path.resolve(SCRIPT_DIR, 'miro-pm-board.mjs');

function loadDotEnvFiles() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(REPO_ROOT, '.env'),
    path.join(os.homedir(), '.env'),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key] && val) {
          process.env[key] = val;
        }
      }
    } catch {
      // Ignore unreadable .env
    }
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function runJsonScript(scriptPath, scriptArgs) {
  const stdout = execFileSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

function readRepoFileExcerpt(relPath, maxChars = 6000) {
  const fullPath = path.resolve(REPO_ROOT, relPath);
  if (!fs.existsSync(fullPath)) return `// ${relPath} (not found)`;
  const content = fs.readFileSync(fullPath, 'utf8');
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n... [truncated ${content.length - maxChars} chars]`;
}

function formatIssueMarkdown(item) {
  const critiqueBullets = (item.pmCritique || [])
    .slice(0, 2)
    .map((b) => `- ${String(b).replace(/^-\s*/, '').trim()}`)
    .join('\n');
  const taskBullets = (item.tasks || [])
    .slice(0, 3)
    .map((t) => `- [ ] ${String(t).replace(/^- (?:\[[ x]\] )?/i, '').trim()}`)
    .join('\n');

  return [
    `**Priority:** \`${item.priority}\` • **Refs:** \`${item.reqRefs}\``,
    '',
    '### Why it matters',
    String(item.whyItMatters).trim(),
    '',
    '### PM Critique',
    critiqueBullets,
    '',
    '### Tasks',
    taskBullets,
    '',
  ].join('\n');
}

async function generateAuditPlan(apiKey, prompt) {
  const client = new GoogleGenAI({ apiKey });
  const preferredModel = process.env.PM_AGENT_MODEL || 'gemini-4-hydrogen';
  const candidateModels = [
    preferredModel,
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
  ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

  const schema = {
    type: 'object',
    properties: {
      auditSummary: { type: 'string' },
      issuesToClose: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'number' },
            resolutionComment: { type: 'string' },
          },
          required: ['number', 'resolutionComment'],
        },
      },
      issuesToCreate: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
            title: { type: 'string' },
            reqRefs: { type: 'string' },
            whyItMatters: { type: 'string' },
            pmCritique: {
              type: 'array',
              items: { type: 'string' },
            },
            tasks: {
              type: 'array',
              items: { type: 'string' },
            },
            miroSummary: { type: 'string' },
          },
          required: [
            'slug',
            'priority',
            'title',
            'reqRefs',
            'whyItMatters',
            'pmCritique',
            'tasks',
            'miroSummary',
          ],
        },
      },
    },
    required: ['auditSummary', 'issuesToClose', 'issuesToCreate'],
  };

  let lastErr = null;
  for (const model of candidateModels) {
    try {
      const interaction = await client.interactions.create({
        model,
        input: prompt,
        store: false,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema,
        },
      });
      if (interaction.output_text) {
        return {
          model,
          plan: JSON.parse(interaction.output_text),
        };
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[PM Agent] Model "${model}" attempt failed: ${err.message || err}`);
    }
  }
  throw lastErr || new Error('Failed to generate PM Agent audit plan from Gemini.');
}

async function main() {
  loadDotEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || process.env.PM_DRY_RUN === 'true');
  const maxNewLimit = args['max-new'] !== undefined ? Number(args['max-new']) : 2;

  const geminiApiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VITE_AI_API_KEY ||
    ''
  ).trim();

  if (!geminiApiKey) {
    throw new Error(
      'Missing GEMINI_API_KEY (or VITE_AI_API_KEY). Add GEMINI_API_KEY to GitHub Repository Secrets or .env.'
    );
  }

  console.log(`[PM Agent] Starting autonomous audit (dryRun=${dryRun})...`);

  // Step 1: Inspect GitHub Issues, Miro Board, and recent Git commits
  const ghState = runJsonScript(GH_SCRIPT, ['list', '--state', 'all']);
  const allIssues = ghState.issues || [];
  const openIssues = allIssues.filter((i) => i.state === 'open');
  const closedIssues = allIssues.filter((i) => i.state === 'closed');

  let miroState = null;
  const miroConfigured = Boolean(
    process.env.MIRO_ACCESS_TOKEN && process.env.MIRO_BOARD_ID
  );
  if (miroConfigured) {
    try {
      miroState = runJsonScript(MIRO_SCRIPT, ['list']);
    } catch (err) {
      console.warn(`[PM Agent] Miro board query failed (continuing with GitHub): ${err.message}`);
    }
  } else {
    console.log('[PM Agent] MIRO_ACCESS_TOKEN / MIRO_BOARD_ID not set; skipping Miro sync.');
  }

  const recentCommits = execSync('git log -n 10 --oneline', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  const latestCommitIso = execSync('git log -1 --format=%cI', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();

  // Step 2: Reconcile any unlinked open GitHub issues onto the Miro Kanban board
  const miroBackfilled = [];
  if (miroState && Array.isArray(miroState.tasks)) {
    for (const issue of openIssues) {
      const alreadyLinked = miroState.tasks.some(
        (t) => t.linkedGithubIssue === issue.number
      );
      if (!alreadyLinked) {
        const cleanTitle = issue.title.replace(/^\[PM Agent\]\s*/i, '');
        if (dryRun) {
          miroBackfilled.push({ dryRun: true, issueNumber: issue.number, title: cleanTitle });
        } else {
          const createdCard = runJsonScript(MIRO_SCRIPT, [
            'create-task',
            '--title',
            cleanTitle,
            '--status',
            'todo',
            '--issue-number',
            String(issue.number),
            '--issue-url',
            issue.html_url,
            '--description',
            `Synced from open GitHub Issue #${issue.number}`,
          ]);
          miroBackfilled.push(createdCard);
        }
      }
    }
  }

  // Step 3: Build codebase & spec snapshot for the LLM audit
  const codebaseSnapshot = [
    '=== specs/03-requirements.md ===',
    readRepoFileExcerpt('specs/03-requirements.md', 8000),
    '=== specs/tasks.md ===',
    readRepoFileExcerpt('specs/tasks.md', 6000),
    '=== src/types/argus.ts ===',
    readRepoFileExcerpt('src/types/argus.ts', 5000),
    '=== src/context/MissionContext.tsx ===',
    readRepoFileExcerpt('src/context/MissionContext.tsx', 6000),
    '=== src/components/TopMissionBar.tsx ===',
    readRepoFileExcerpt('src/components/TopMissionBar.tsx', 5000),
    '=== src/components/TelemetryPanel.tsx ===',
    readRepoFileExcerpt('src/components/TelemetryPanel.tsx', 5000),
    '=== src/components/FlightSurgeonPanel.tsx ===',
    readRepoFileExcerpt('src/components/FlightSurgeonPanel.tsx', 5000),
  ].join('\n\n');

  const prompt = `You are the Autonomous Product Manager (PM) Agent for ARGUS (Astronaut Readiness Guidance & Unified Surveillance, repository ${ghState.repo}).

Your Core Mandate:
1. Evaluate the codebase against specs/03-requirements.md (REQ-01 through REQ-10). Prioritize what wins the hackathon and makes ARGUS genuinely usable for an astronaut in a 20-minute communication blackout.
2. Be candid and direct: point out read-only dead ends, missing interactive loops, or partial/unimplemented requirements in src/.
3. Keep every issue short and scannable in under 10 seconds (1-sentence "Why it matters", 1-2 short bullets in "PM Critique" citing exact src/ files, and 2-3 short concrete checkbox tasks).
4. Never duplicate any existing open or recently closed issue.

Recent Git Commits (latest commit timestamp: ${latestCommitIso}):
${recentCommits}

Currently Open GitHub Issues (${openIssues.length}):
${JSON.stringify(openIssues, null, 2)}

Recently Closed GitHub Issues (${closedIssues.length}):
${JSON.stringify(closedIssues.slice(0, 10), null, 2)}

Codebase & Specs Snapshot:
${codebaseSnapshot}

Instructions:
1. Check every currently OPEN GitHub issue above. ONLY include an issue in "issuesToClose" if you can verify in the Codebase Snapshot that its requested feature/tasks are now genuinely implemented in src/. Do NOT close an issue if it is still unimplemented.
2. Propose at most ${maxNewLimit} high-impact new issues in "issuesToCreate" for gaps in REQ-01 through REQ-10 that are NOT already covered by an existing open issue. If existing open issues already cover the top priorities, return an empty array [] for "issuesToCreate".`;

  const { model, plan } = await generateAuditPlan(geminiApiKey, prompt);

  // Step 4: Execute closures first
  const closedResults = [];
  const openIssueMap = new Map(openIssues.map((i) => [i.number, i]));

  for (const toClose of plan.issuesToClose || []) {
    if (!openIssueMap.has(toClose.number)) continue;
    if (dryRun) {
      closedResults.push({ dryRun: true, ...toClose });
      openIssueMap.delete(toClose.number);
      continue;
    }

    const closeRes = runJsonScript(GH_SCRIPT, [
      'close',
      String(toClose.number),
      '--comment',
      toClose.resolutionComment,
    ]);
    closedResults.push(closeRes);
    openIssueMap.delete(toClose.number);

    if (miroState && Array.isArray(miroState.tasks)) {
      const linkedCards = miroState.tasks.filter(
        (t) => t.linkedGithubIssue === toClose.number
      );
      for (const card of linkedCards) {
        try {
          runJsonScript(MIRO_SCRIPT, ['update-task', String(card.id), '--status', 'done']);
        } catch (err) {
          console.warn(`[PM Agent] Failed to mark Miro card ${card.id} done: ${err.message}`);
        }
      }
    }
  }

  // Enforce 5-open-issue No Spam Guardrail after accounting for closed issues
  const remainingOpenPmIssues = Array.from(openIssueMap.values()).filter((i) =>
    /^\[pm(?:\s+agent)?\]/i.test(i.title)
  );
  const newestOpenIssueIso = remainingOpenPmIssues.reduce(
    (max, i) => (i.created_at > max ? i.created_at : max),
    ''
  );
  const noNewCommitsSinceLastIssue =
    newestOpenIssueIso &&
    new Date(latestCommitIso).getTime() <= new Date(newestOpenIssueIso).getTime();

  let allowedNewCount = Math.max(
    0,
    Math.min(maxNewLimit, 5 - remainingOpenPmIssues.length)
  );
  if (remainingOpenPmIssues.length >= 5 && noNewCommitsSinceLastIssue) {
    allowedNewCount = 0;
  }

  const createdResults = [];
  fs.mkdirSync(ISSUES_DIR, { recursive: true });

  for (const item of (plan.issuesToCreate || []).slice(0, allowedNewCount)) {
    const safeSlug =
      String(item.slug || 'pm-issue')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'pm-issue';
    const issueFilePath = path.resolve(ISSUES_DIR, `${safeSlug}.md`);
    const bodyMarkdown = formatIssueMarkdown(item);
    fs.writeFileSync(issueFilePath, bodyMarkdown, 'utf8');

    const cleanActionTitle = String(item.title)
      .replace(/^\[PM(?:\s+Agent)?\]\s*/i, '')
      .replace(/^\[P[012]\]\s*/i, '')
      .trim();
    const fullTitle = `[PM Agent] [${item.priority}] ${cleanActionTitle}`;

    if (dryRun) {
      createdResults.push({
        dryRun: true,
        title: fullTitle,
        issueFilePath,
        bodyMarkdown,
      });
      continue;
    }

    const createRes = runJsonScript(GH_SCRIPT, [
      'create',
      '--title',
      fullTitle,
      '--body',
      `@${issueFilePath}`,
    ]);
    createdResults.push(createRes);

    if (createRes.created && createRes.number && miroConfigured) {
      try {
        const miroCard = runJsonScript(MIRO_SCRIPT, [
          'create-task',
          '--title',
          `[${item.priority}] ${cleanActionTitle}`,
          '--status',
          'todo',
          '--issue-number',
          String(createRes.number),
          '--issue-url',
          createRes.html_url,
          '--description',
          item.miroSummary || item.whyItMatters,
        ]);
        createRes.miroCard = miroCard;
      } catch (err) {
        console.warn(
          `[PM Agent] Created GitHub issue #${createRes.number} but Miro sync failed: ${err.message}`
        );
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        modelUsed: model,
        repo: ghState.repo,
        auditSummary: plan.auditSummary,
        openIssuesBefore: openIssues.length,
        closedIssuesCount: closedResults.length,
        closedIssues: closedResults,
        miroBackfilledCount: miroBackfilled.length,
        miroBackfilled,
        allowedNewIssues: allowedNewCount,
        createdIssuesCount: createdResults.length,
        createdIssues: createdResults,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[PM Agent Error]', err.message || err);
  process.exit(1);
});
