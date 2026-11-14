#!/usr/bin/env node
/**
 * ARGUS Autonomous Software Engineer (SWE) Agent — GitHub PR & Task CLI Utility
 *
 * Authenticates using GITHUB_TOKEN / GH_PROJECT_TOKEN / GH_TOKEN or git's configured
 * credential helper and manages agent-assigned issues (`agent-task`) and Pull Requests
 * while explicitly identifying as the ARGUS SWE Agent (`[SWE Agent]`).
 *
 * Usage:
 *   node .agents/skills/swe-agent/scripts/gh-swe-pr.mjs list-tasks [--issue <number>]
 *   node .agents/skills/swe-agent/scripts/gh-swe-pr.mjs list-prs [--state open|closed|all]
 *   node .agents/skills/swe-agent/scripts/gh-swe-pr.mjs create-pr --issue <n> --head <branch> [--base main] --title "<title>" --body "<md_or_@file>" [--labels "l1,l2"]
 *   node .agents/skills/swe-agent/scripts/gh-swe-pr.mjs comment-issue <issue_number> --body "<md_or_@file>"
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO = 'Space-Apps-Nadague/Argus';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');

export function loadDotEnvFiles() {
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

export function getRepoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
    if (match) return match[1];
  } catch {
    // Fallback
  }
  return DEFAULT_REPO;
}

export function getGitHubTokens() {
  const tokens = [];
  if (process.env.GITHUB_TOKEN) tokens.push(process.env.GITHUB_TOKEN.trim());
  if (process.env.GH_PROJECT_TOKEN) tokens.push(process.env.GH_PROJECT_TOKEN.trim());
  if (process.env.GH_TOKEN) tokens.push(process.env.GH_TOKEN.trim());

  if (tokens.length === 0) {
    try {
      const output = execSync('git credential fill', {
        input: 'protocol=https\nhost=github.com\n\n',
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const passwordMatch = output.match(/^password=(.+)$/m);
      if (passwordMatch && passwordMatch[1]) {
        tokens.push(passwordMatch[1].trim());
      }
    } catch {
      // Ignore
    }
  }

  const unique = Array.from(new Set(tokens.filter(Boolean)));
  if (unique.length === 0) {
    throw new Error(
      'Unable to find GitHub credentials. Set GITHUB_TOKEN / GH_PROJECT_TOKEN or configure git credential helper.'
    );
  }
  return unique;
}

export function githubRequest(method, apiPath, token, payload = null) {
  return new Promise((resolve, reject) => {
    const bodyString = payload ? JSON.stringify(payload) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'ARGUS-SWE-Agent/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(bodyString
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyString),
              }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = data;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            // keep raw string
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(
              new Error(
                `GitHub API ${method} ${apiPath} failed (${res.statusCode}): ${
                  typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
                }`
              )
            );
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function githubRequestWithFallback(method, apiPath, tokens, payload = null) {
  let lastErr = null;
  for (const token of tokens) {
    try {
      return await githubRequest(method, apiPath, token, payload);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export function wrapSweBody(rawBody) {
  const actorLabel =
    process.env.GITHUB_ACTIONS === 'true'
      ? '*(via `github-actions[bot]`)*'
      : '*(via `@YaronL16`)*';
  const header = `> 🛠️ **ARGUS SWE Agent** ${actorLabel}\n\n`;
  if (rawBody.includes('ARGUS SWE Agent') || rawBody.includes('ARGUS Software Engineer')) {
    return rawBody;
  }
  return `${header}${rawBody.trim()}`;
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

function resolveTextArg(val) {
  if (!val || typeof val !== 'string') return '';
  if (val.startsWith('@') && fs.existsSync(val.slice(1))) {
    return fs.readFileSync(val.slice(1), 'utf8');
  }
  return val.replace(/\\n/g, '\n');
}

function extractPriorityRank(issue) {
  const combined = `${issue.title || ''}\n${issue.body || ''}`;
  if (/\[P0\]|\bPriority:\*\*\s*`?P0`?/i.test(combined)) return 0;
  if (/\[P2\]|\bPriority:\*\*\s*`?P2`?/i.test(combined)) return 2;
  return 1;
}

function findLinkedPrForIssue(issueNumber, openPrs) {
  const num = Number(issueNumber);
  const issuePatterns = [
    new RegExp(`(?:closes|fixes|resolves)\\s+#${num}\\b`, 'i'),
    new RegExp(`\\bswe/issue-${num}(?:\\b|-)`, 'i'),
    new RegExp(`#${num}\\b`),
  ];

  for (const pr of openPrs) {
    const headRef = pr.head?.ref || '';
    const text = `${pr.title || ''}\n${pr.body || ''}\n${headRef}`;
    if (issuePatterns.some((re) => re.test(text))) {
      return {
        number: pr.number,
        title: pr.title,
        headRef,
        html_url: pr.html_url,
      };
    }
  }
  return null;
}

async function main() {
  loadDotEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'list-tasks';
  const repo = getRepoSlug();
  const tokens = getGitHubTokens();

  if (command === 'list-tasks') {
    const targetIssueNum = args.issue ? Number(args.issue) : null;
    const [rawIssues, openPrs] = await Promise.all([
      githubRequestWithFallback(
        'GET',
        `/repos/${repo}/issues?state=open&per_page=100`,
        tokens
      ),
      githubRequestWithFallback(
        'GET',
        `/repos/${repo}/pulls?state=open&per_page=100`,
        tokens
      ),
    ]);

    const allOpenIssues = rawIssues
      .filter((item) => !item.pull_request)
      .map((issue) => {
        const labels = (issue.labels || []).map((l) =>
          typeof l === 'string' ? l : l.name
        );
        const linkedPr = findLinkedPrForIssue(issue.number, openPrs);
        const isAgentTask = labels.includes('agent-task') && !labels.includes('human-review');
        return {
          number: issue.number,
          state: issue.state,
          title: issue.title,
          labels,
          priorityRank: extractPriorityRank(issue),
          isAgentTask,
          linkedPr,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          html_url: issue.html_url,
          body: issue.body || '',
        };
      });

    const filtered = allOpenIssues
      .filter((issue) => {
        if (targetIssueNum) {
          return issue.number === targetIssueNum && (args.force || !issue.labels.includes('human-review'));
        }
        return issue.isAgentTask;
      })
      .sort((a, b) => {
        if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
        return a.number - b.number;
      });

    const actionableTasks = filtered.filter((i) => !i.linkedPr);

    console.log(
      JSON.stringify(
        {
          repo,
          totalOpenIssues: allOpenIssues.length,
          totalAgentTasks: filtered.length,
          actionableCount: actionableTasks.length,
          actionableTasks,
          allAgentTasks: filtered,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'list-prs') {
    const state = args.state || 'open';
    const rawPrs = await githubRequestWithFallback(
      'GET',
      `/repos/${repo}/pulls?state=${encodeURIComponent(state)}&per_page=50`,
      tokens
    );
    const prs = rawPrs.map((pr) => ({
      number: pr.number,
      state: pr.state,
      title: pr.title,
      head: pr.head?.ref,
      base: pr.base?.ref,
      html_url: pr.html_url,
      created_at: pr.created_at,
    }));
    console.log(JSON.stringify({ repo, total: prs.length, prs }, null, 2));
    return;
  }

  if (command === 'create-pr') {
    const issueNumber = Number(args.issue);
    const head = String(args.head || '').trim();
    const base = String(args.base || 'main').trim();
    const rawTitle = resolveTextArg(args.title);
    const rawBody = resolveTextArg(args.body);

    if (!issueNumber || !head || !rawTitle || !rawBody) {
      throw new Error(
        'Usage: gh-swe-pr.mjs create-pr --issue <n> --head <branch> [--base main] --title "<title>" --body "<md_or_@file>"'
      );
    }

    const formattedTitle = rawTitle.startsWith('[SWE Agent]')
      ? rawTitle
      : `[SWE Agent] ${rawTitle.replace(/^\[(?:PM|SWE)(?:\s+Agent)?\]\s*/i, '')}`;

    const closingLine = `Closes #${issueNumber}`;
    const bodyWithCloses = rawBody.includes(`#${issueNumber}`)
      ? rawBody
      : `${rawBody.trim()}\n\n${closingLine}`;

    // Check if an open PR already exists for this branch
    const [repoOwner] = repo.split('/');
    const existingPrs = await githubRequestWithFallback(
      'GET',
      `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repoOwner}:${head}`)}`,
      tokens
    );

    let prResult;
    let wasUpdated = false;
    if (Array.isArray(existingPrs) && existingPrs.length > 0) {
      const existing = existingPrs[0];
      prResult = await githubRequestWithFallback(
        'PATCH',
        `/repos/${repo}/pulls/${existing.number}`,
        tokens,
        {
          title: formattedTitle,
          body: wrapSweBody(bodyWithCloses),
        }
      );
      wasUpdated = true;
    } else {
      prResult = await githubRequestWithFallback(
        'POST',
        `/repos/${repo}/pulls`,
        tokens,
        {
          title: formattedTitle,
          head,
          base,
          body: wrapSweBody(bodyWithCloses),
          draft: Boolean(args.draft),
        }
      );
    }

    // Apply labels to the PR if provided
    if (args.labels && prResult?.number) {
      const labels = String(args.labels)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (labels.length > 0) {
        try {
          await githubRequestWithFallback(
            'POST',
            `/repos/${repo}/issues/${prResult.number}/labels`,
            tokens,
            { labels }
          );
        } catch (err) {
          console.warn(`[SWE Agent] Warning: Failed to label PR #${prResult.number}: ${err.message}`);
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          created: !wasUpdated,
          updated: wasUpdated,
          prNumber: prResult.number,
          title: prResult.title,
          head,
          base,
          issueNumber,
          html_url: prResult.html_url,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'comment-issue') {
    const number = args._[1] || args.issue;
    const rawBody = resolveTextArg(args.body);
    if (!number || !rawBody) {
      throw new Error(
        'Usage: gh-swe-pr.mjs comment-issue <issue_number> --body "<markdown_or_@file>"'
      );
    }
    const created = await githubRequestWithFallback(
      'POST',
      `/repos/${repo}/issues/${number}/comments`,
      tokens,
      {
        body: wrapSweBody(rawBody),
      }
    );
    console.log(
      JSON.stringify(
        {
          commented: true,
          issue_number: Number(number),
          comment_id: created.id,
          html_url: created.html_url,
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(
    `Unknown subcommand "${command}". Use: list-tasks, list-prs, create-pr, or comment-issue.`
  );
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
