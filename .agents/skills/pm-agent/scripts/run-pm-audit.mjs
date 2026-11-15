#!/usr/bin/env node
/**
 * ARGUS Product Manager (PM) Agent — Autonomous Headless Audit Runner
 *
 * Designed to run in GitHub Actions (as `github-actions[bot]`) or locally via CLI.
 * Executes the 4-step PM Agent workflow defined in `.agents/skills/pm-agent/SKILL.md`:
 *   1. Inspects open/closed GitHub issues, GitHub Projects v2 board, and recent commits.
 *   2. Reconciles unlinked open GitHub issues onto the GitHub Projects v2 Kanban board.
 *   3. Audits `specs/03-requirements.md` (`REQ-01`–`REQ-10`) against `src/` using Gemini
 *      structured JSON output (`@google/genai`).
 *   4. Closes resolved GitHub issues (+ marks Project cards `Done`) and opens concise
 *      new `[PM Agent]` issues (+ adds Project `Todo` cards) while enforcing
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
const REPO_ROOT = path.resolve(SKILL_DIR, '../../..');
const GH_SCRIPT = path.resolve(SCRIPT_DIR, 'gh-pm-issue.mjs');
const PROJECT_SCRIPT = path.resolve(SCRIPT_DIR, 'gh-pm-project.mjs');

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

function inferKanbanColumn(priorityOrTitle) {
  const text = String(priorityOrTitle || '').toUpperCase();
  if (text.includes('P0')) return 'urgent';
  if (text.includes('P2')) return 'backlog';
  return 'todo';
}

function inferPriorityTag(priorityOrTitle) {
  const text = String(priorityOrTitle || '').toUpperCase();
  if (text.includes('P0')) return 'P0';
  if (text.includes('P2')) return 'P2';
  return 'P1';
}

const CATEGORY_LABELS = ['ui-ux', 'clinical-ai', 'telemetry-data', 'infra-ci'];

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
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
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
      issuesToUpdate: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'number' },
            newPriority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
            newAssigneeType: {
              type: 'string',
              enum: ['human-review', 'agent-task'],
            },
            newCategory: {
              type: 'string',
              enum: ['ui-ux', 'clinical-ai', 'telemetry-data', 'infra-ci'],
            },
            newKanbanColumn: {
              type: 'string',
              enum: ['backlog', 'todo', 'urgent', 'in progress'],
            },
            comment: { type: 'string' },
          },
          required: [
            'number',
            'newPriority',
            'newAssigneeType',
            'newCategory',
            'newKanbanColumn',
            'comment',
          ],
        },
      },
      issuesToCreate: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
            assigneeType: {
              type: 'string',
              enum: ['human-review', 'agent-task'],
            },
            category: {
              type: 'string',
              enum: ['ui-ux', 'clinical-ai', 'telemetry-data', 'infra-ci'],
            },
            kanbanColumn: {
              type: 'string',
              enum: ['backlog', 'todo', 'urgent'],
            },
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
            projectSummary: { type: 'string' },
          },
          required: [
            'slug',
            'priority',
            'assigneeType',
            'category',
            'kanbanColumn',
            'title',
            'reqRefs',
            'whyItMatters',
            'pmCritique',
            'tasks',
            'projectSummary',
          ],
        },
      },
    },
    required: ['auditSummary', 'issuesToClose', 'issuesToUpdate', 'issuesToCreate'],
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

  // Step 1: Inspect GitHub Issues, GitHub Projects v2 Board, and recent Git commits
  const ghState = runJsonScript(GH_SCRIPT, ['list', '--state', 'all']);
  const allIssues = ghState.issues || [];
  const openIssues = allIssues.filter((i) => i.state === 'open');
  const closedIssues = allIssues.filter((i) => i.state === 'closed');

  let projectState = null;
  const projectConfigured = Boolean(
    process.env.PM_PROJECT_NUMBER || process.env.GITHUB_PROJECT_NUMBER
  );
  if (projectConfigured) {
    try {
      projectState = runJsonScript(PROJECT_SCRIPT, ['list']);
    } catch (err) {
      console.warn(
        `[PM Agent] GitHub Project query failed (continuing with GitHub Issues): ${err.message}`
      );
    }
  } else {
    console.log(
      '[PM Agent] PM_PROJECT_NUMBER not set; skipping GitHub Projects v2 Kanban sync.'
    );
  }

  const recentCommits = execSync('git log -n 10 --oneline', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  const latestCommitIso = execSync('git log -1 --format=%cI', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  const latestCodeCommitIso = execSync('git log -1 --format=%cI -- src/ specs/', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();

  // Step 2: Reconcile any unlinked open GitHub issues onto the GitHub Projects v2 board
  const projectBackfilled = [];
  if (projectState && Array.isArray(projectState.items)) {
    for (const issue of openIssues) {
      const alreadyInProject = projectState.items.some(
        (t) => t.issueNumber === issue.number
      );
      if (!alreadyInProject) {
        const targetStatus = inferKanbanColumn(issue.title);
        const targetPriority = inferPriorityTag(issue.title);
        if (dryRun) {
          projectBackfilled.push({
            dryRun: true,
            issueNumber: issue.number,
            title: issue.title,
            status: targetStatus,
            priority: targetPriority,
          });
        } else {
          const syncedItem = runJsonScript(PROJECT_SCRIPT, [
            'sync-issue',
            '--issue-number',
            String(issue.number),
            '--status',
            targetStatus,
            '--priority',
            targetPriority,
          ]);
          projectBackfilled.push(syncedItem);
        }
      }
    }
  }

  // Step 3: Build codebase & spec snapshot for the LLM audit
  const codebaseSnapshot = [
    '=== specs/03-requirements.md ===',
    readRepoFileExcerpt('specs/03-requirements.md', 10000),
    '=== specs/01-data-schema.md ===',
    readRepoFileExcerpt('specs/01-data-schema.md', 10000),
    '=== specs/02-ui-dashboard.md ===',
    readRepoFileExcerpt('specs/02-ui-dashboard.md', 8000),
    '=== specs/04-ai-backend.md ===',
    readRepoFileExcerpt('specs/04-ai-backend.md', 8000),
    '=== src/types/argus.ts ===',
    readRepoFileExcerpt('src/types/argus.ts', 8000),
    '=== src/utils/triageEngine.ts ===',
    readRepoFileExcerpt('src/utils/triageEngine.ts', 8000),
    '=== src/data/telemetryScenarios.ts (head) ===',
    readRepoFileExcerpt('src/data/telemetryScenarios.ts', 8000),
    '=== src/services/flightSurgeonAi.ts ===',
    readRepoFileExcerpt('src/services/flightSurgeonAi.ts', 15000),
    '=== src/context/MissionContext.tsx ===',
    readRepoFileExcerpt('src/context/MissionContext.tsx', 25000),
    '=== src/App.tsx ===',
    readRepoFileExcerpt('src/App.tsx', 5000),
    '=== src/components/TopMissionBar.tsx ===',
    readRepoFileExcerpt('src/components/TopMissionBar.tsx', 15000),
    '=== src/components/TabBar.tsx ===',
    readRepoFileExcerpt('src/components/TabBar.tsx', 5000),
    '=== src/components/BioTwinTab.tsx ===',
    readRepoFileExcerpt('src/components/BioTwinTab.tsx', 8000),
    '=== src/components/TrendsTab.tsx ===',
    readRepoFileExcerpt('src/components/TrendsTab.tsx', 15000),
    '=== src/components/CheckInTab.tsx ===',
    readRepoFileExcerpt('src/components/CheckInTab.tsx', 12000),
    '=== src/components/CrewTab.tsx ===',
    readRepoFileExcerpt('src/components/CrewTab.tsx', 10000),
    '=== src/components/FlightSurgeonPanel.tsx ===',
    readRepoFileExcerpt('src/components/FlightSurgeonPanel.tsx', 22000),
    '=== src/components/BioTwinMap.tsx ===',
    readRepoFileExcerpt('src/components/BioTwinMap.tsx', 12000),
    '=== src/components/CrewManagerModal.tsx ===',
    readRepoFileExcerpt('src/components/CrewManagerModal.tsx', 10000),
  ].join('\n\n');

  const prompt = `You are the Autonomous Product Manager (PM) Agent for ARGUS (Astronaut Readiness Guidance & Unified Surveillance, repository ${ghState.repo}).

Your Core Mandate:
1. Evaluate the codebase against specs/03-requirements.md (REQ-01 through REQ-10). Prioritize what wins the hackathon and makes ARGUS genuinely usable for an astronaut in a 20-minute communication blackout.
2. Be candid and direct: point out read-only dead ends, missing interactive loops, or partial/unimplemented requirements in src/.
3. Keep every issue short and scannable in under 10 seconds (1-sentence "Why it matters", 1-2 short bullets in "PM Critique" citing exact src/ files, and 2-3 short concrete checkbox tasks).
4. Never duplicate any existing open or recently closed issue.

Recent Git Commits (latest commit: ${latestCommitIso}; latest src/ or specs/ commit: ${latestCodeCommitIso || 'none'}):
${recentCommits}

Currently Open GitHub Issues (${openIssues.length}):
${JSON.stringify(openIssues, null, 2)}

Current GitHub Projects v2 Kanban Items (${projectState?.items?.length || 0}):
${JSON.stringify(projectState?.items || [], null, 2)}

Recently Closed GitHub Issues (${closedIssues.length}):
${JSON.stringify(closedIssues.slice(0, 10), null, 2)}

Codebase & Specs Snapshot:
${codebaseSnapshot}

Instructions:
1. Check every currently OPEN GitHub issue above. ONLY include an issue in "issuesToClose" if you can verify in the Codebase Snapshot that its requested feature/tasks are now genuinely implemented in src/. Do NOT close an issue if it is still unimplemented.
2. Review all remaining OPEN issues in "issuesToUpdate":
   - If an issue is missing a "human-review" or "agent-task" label, missing a category label ("ui-ux", "clinical-ai", "telemetry-data", "infra-ci"), or has the wrong label, priority (P0/P1/P2), Project Priority field, or Kanban column ("urgent"/"todo"/"backlog"), include it in "issuesToUpdate" with the corrected values.
   - Use "comment" to post a concise status update, progress note from recent src/ or specs/ commits, or a ping (e.g., "@YaronL16" for "human-review" blockers or stale P0s) ONLY when meaningful. Do NOT write a comment merely to announce applying/fixing labels or moving Kanban columns—leave "comment" as "" for metadata-only syncs or when src/ and specs/ have not changed.
3. Propose at most ${maxNewLimit} high-impact new issues in "issuesToCreate" for gaps in REQ-01 through REQ-10 that are NOT already covered by an existing open issue. If existing open issues already cover the top priorities, return an empty array [] for "issuesToCreate".
4. For each new issue:
   - Set "assigneeType" to "human-review" if it requires a human product/UX/clinical/credential decision or manual review, or "agent-task" if it is a concrete coding/spec/UI task ready for an AI coding agent to implement.
   - Set "category" to one of: "ui-ux", "clinical-ai", "telemetry-data", or "infra-ci".
   - Set "kanbanColumn" based on urgency: "urgent" for P0 (critical hackathon/demo impact), "todo" for P1 (regular urgency), or "backlog" for P2 (not urgent / polish).`;

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

    if (projectConfigured) {
      try {
        runJsonScript(PROJECT_SCRIPT, [
          'sync-issue',
          '--issue-number',
          String(toClose.number),
          '--status',
          'done',
        ]);
      } catch (err) {
        console.warn(
          `[PM Agent] Failed to mark Project item for issue #${toClose.number} done: ${err.message}`
        );
      }
    }
  }

  // Step 4b: Reconcile open issues (re-prioritize, fix labels, sync Kanban, or comment/ping)
  const updatedResults = [];
  const projectItemByIssue = new Map(
    (projectState?.items || []).map((item) => [item.issueNumber, item])
  );

  for (const upd of plan.issuesToUpdate || []) {
    const existing = openIssueMap.get(upd.number);
    if (!existing) continue;

    const currentLabels = existing.labels || [];
    const targetAssigneeLabel =
      upd.newAssigneeType === 'human-review' ? 'human-review' : 'agent-task';
    const targetCategoryLabel = CATEGORY_LABELS.includes(upd.newCategory)
      ? upd.newCategory
      : 'ui-ux';
    const otherLabels = currentLabels.filter(
      (l) =>
        l !== 'human-review' &&
        l !== 'agent-task' &&
        !CATEGORY_LABELS.includes(l)
    );
    const nextLabels = [...otherLabels, targetAssigneeLabel, targetCategoryLabel];
    const labelsChanged =
      !currentLabels.includes(targetAssigneeLabel) ||
      !currentLabels.includes(targetCategoryLabel) ||
      (currentLabels.includes('human-review') && currentLabels.includes('agent-task')) ||
      currentLabels.filter((l) => CATEGORY_LABELS.includes(l)).length > 1;

    const cleanBodyTitle = existing.title
      .replace(/^\[PM(?:\s+Agent)?\]\s*/i, '')
      .replace(/^\[P[012]\]\s*/i, '')
      .trim();
    const nextTitle = `[PM Agent] [${upd.newPriority}] ${cleanBodyTitle}`;
    const titleChanged = nextTitle !== existing.title;

    const existingProjectItem = projectItemByIssue.get(upd.number);
    const currentKanban = (existingProjectItem?.status || '').toLowerCase();
    const isAlreadyInProgress =
      currentKanban.includes('in progress') || currentKanban.includes('doing');
    const targetKanban = isAlreadyInProgress
      ? 'in progress'
      : upd.newKanbanColumn || inferKanbanColumn(upd.newPriority);
    const kanbanChanged = !currentKanban || !currentKanban.includes(targetKanban);
    const currentProjectPriority = (existingProjectItem?.priority || '').toUpperCase();
    const projectPriorityChanged =
      Boolean(projectState?.hasPriorityField) &&
      (!currentProjectPriority || currentProjectPriority !== upd.newPriority.toUpperCase());

    const commentText = String(upd.comment || '').trim();
    const updatedRecently =
      existing.updated_at &&
      Date.now() - new Date(existing.updated_at).getTime() < 60 * 60 * 1000;
    const shouldComment =
      Boolean(commentText) && (labelsChanged || titleChanged || kanbanChanged || !updatedRecently);

    if (
      !labelsChanged &&
      !titleChanged &&
      !kanbanChanged &&
      !projectPriorityChanged &&
      !shouldComment
    ) {
      continue;
    }

    if (dryRun) {
      updatedResults.push({
        dryRun: true,
        number: upd.number,
        titleChanged,
        nextTitle: titleChanged ? nextTitle : undefined,
        labelsChanged,
        nextLabels: labelsChanged ? nextLabels : undefined,
        kanbanChanged,
        targetKanban,
        projectPriorityChanged,
        targetPriority: upd.newPriority,
        comment: shouldComment ? commentText : undefined,
      });
      continue;
    }

    const actionRecord = { number: upd.number };
    if (titleChanged || labelsChanged) {
      const editArgs = ['edit', String(upd.number)];
      if (titleChanged) editArgs.push('--title', nextTitle);
      if (labelsChanged) editArgs.push('--labels', nextLabels.join(','));
      actionRecord.edit = runJsonScript(GH_SCRIPT, editArgs);
    }
    if ((kanbanChanged || projectPriorityChanged) && projectConfigured) {
      try {
        actionRecord.projectItem = runJsonScript(PROJECT_SCRIPT, [
          'sync-issue',
          '--issue-number',
          String(upd.number),
          '--status',
          targetKanban,
          '--priority',
          upd.newPriority,
        ]);
      } catch (err) {
        console.warn(
          `[PM Agent] Failed to update Project fields for #${upd.number}: ${err.message}`
        );
      }
    }
    if (shouldComment) {
      actionRecord.comment = runJsonScript(GH_SCRIPT, [
        'comment',
        String(upd.number),
        '--body',
        commentText,
      ]);
    }
    updatedResults.push(actionRecord);
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
    latestCodeCommitIso &&
    new Date(latestCodeCommitIso).getTime() <= new Date(newestOpenIssueIso).getTime();

  let allowedNewCount = Math.max(
    0,
    Math.min(maxNewLimit, 5 - remainingOpenPmIssues.length)
  );
  if (remainingOpenPmIssues.length >= 5 && noNewCommitsSinceLastIssue) {
    allowedNewCount = 0;
  }

  const createdResults = [];

  for (const item of (plan.issuesToCreate || []).slice(0, allowedNewCount)) {
    const safeSlug =
      String(item.slug || 'pm-issue')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'pm-issue';
    const bodyMarkdown = formatIssueMarkdown(item);

    const cleanActionTitle = String(item.title)
      .replace(/^\[PM(?:\s+Agent)?\]\s*/i, '')
      .replace(/^\[P[012]\]\s*/i, '')
      .trim();
    const fullTitle = `[PM Agent] [${item.priority}] ${cleanActionTitle}`;
    const issueLabel = item.assigneeType === 'human-review' ? 'human-review' : 'agent-task';
    const categoryLabel = CATEGORY_LABELS.includes(item.category)
      ? item.category
      : 'ui-ux';
    const issueLabels = [issueLabel, categoryLabel];
    const kanbanStatus = item.kanbanColumn || inferKanbanColumn(item.priority);

    if (dryRun) {
      createdResults.push({
        dryRun: true,
        title: fullTitle,
        labels: issueLabels,
        kanbanStatus,
        priority: item.priority,
        bodyMarkdown,
      });
      continue;
    }

    const issueFilePath = path.join(os.tmpdir(), `argus-pm-${safeSlug}-${Date.now()}.md`);
    fs.writeFileSync(issueFilePath, bodyMarkdown, 'utf8');
    let createRes;
    try {
      createRes = runJsonScript(GH_SCRIPT, [
        'create',
        '--title',
        fullTitle,
        '--labels',
        issueLabels.join(','),
        '--body',
        `@${issueFilePath}`,
      ]);
    } finally {
      try {
        fs.unlinkSync(issueFilePath);
      } catch {
        // ignore temp cleanup failure
      }
    }
    createdResults.push(createRes);

    if (createRes.created && createRes.number && projectConfigured) {
      try {
        const projectItem = runJsonScript(PROJECT_SCRIPT, [
          'sync-issue',
          '--issue-number',
          String(createRes.number),
          '--status',
          kanbanStatus,
          '--priority',
          item.priority,
        ]);
        createRes.projectItem = projectItem;
      } catch (err) {
        console.warn(
          `[PM Agent] Created GitHub issue #${createRes.number} but GitHub Project sync failed: ${err.message}`
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
        updatedIssuesCount: updatedResults.length,
        updatedIssues: updatedResults,
        projectBackfilledCount: projectBackfilled.length,
        projectBackfilled,
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
