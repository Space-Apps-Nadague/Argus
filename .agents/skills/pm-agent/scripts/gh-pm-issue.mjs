#!/usr/bin/env node
/**
 * ARGUS Product Manager (PM) Agent — GitHub Issues CLI Utility
 *
 * Authenticates using GITHUB_TOKEN / GH_TOKEN or git's configured credential helper
 * (e.g. macOS Keychain for YaronL16) and manages GitHub issues on Space-Apps-Nadague/Argus
 * while explicitly identifying as the ARGUS Product Manager (PM) Agent.
 *
 * Usage:
 *   node .agents/skills/pm-agent/scripts/gh-pm-issue.mjs list [--state open|closed|all]
 *   node .agents/skills/pm-agent/scripts/gh-pm-issue.mjs view <issue_number>
 *   node .agents/skills/pm-agent/scripts/gh-pm-issue.mjs create --title "<title>" --body "<markdown>" [--labels "l1,l2"] [--force]
 *   node .agents/skills/pm-agent/scripts/gh-pm-issue.mjs comment <issue_number> --body "<markdown>"
 *   node .agents/skills/pm-agent/scripts/gh-pm-issue.mjs close <issue_number> [--comment "<markdown>"]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';

const DEFAULT_REPO = 'Space-Apps-Nadague/Argus';

function getRepoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
    if (match) return match[1];
  } catch {
    // Fallback to default
  }
  return DEFAULT_REPO;
}

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();

  try {
    const output = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const passwordMatch = output.match(/^password=(.+)$/m);
    if (passwordMatch && passwordMatch[1]) {
      return passwordMatch[1].trim();
    }
  } catch {
    // Ignore and throw helpful error below
  }

  throw new Error(
    'Unable to find GitHub credentials. Ensure git credential helper (osxkeychain) has a token for github.com or set GITHUB_TOKEN.'
  );
}

function githubRequest(method, apiPath, token, payload = null) {
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
          'User-Agent': 'ARGUS-PM-Agent/1.0',
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

function wrapPmBody(rawBody) {
  const actorLabel =
    process.env.GITHUB_ACTIONS === 'true'
      ? '*(via `github-actions[bot]`)*'
      : '*(via `@YaronL16`)*';
  const header = `> 🤖 **ARGUS PM Agent** ${actorLabel}\n\n`;
  if (rawBody.includes('ARGUS PM Agent') || rawBody.includes('ARGUS Product Manager (PM) Agent')) {
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

function normalizeTitleForDedup(title) {
  return title
    .toLowerCase()
    .replace(/^\[pm(?:\s+agent)?\]\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'list';
  const repo = getRepoSlug();
  const token = getGitHubToken();

  if (command === 'list') {
    const state = args.state || 'all';
    const rawIssues = await githubRequest(
      'GET',
      `/repos/${repo}/issues?state=${encodeURIComponent(state)}&per_page=50`,
      token
    );
    const issues = rawIssues
      .filter((item) => !item.pull_request)
      .map((issue) => ({
        number: issue.number,
        state: issue.state,
        title: issue.title,
        labels: (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        comments: issue.comments,
        html_url: issue.html_url,
        body_excerpt: (issue.body || '').slice(0, 500),
      }));
    console.log(JSON.stringify({ repo, total: issues.length, issues }, null, 2));
    return;
  }

  if (command === 'view') {
    const number = args._[1];
    if (!number) throw new Error('Usage: gh-pm-issue.mjs view <issue_number>');
    const issue = await githubRequest('GET', `/repos/${repo}/issues/${number}`, token);
    const comments = await githubRequest(
      'GET',
      `/repos/${repo}/issues/${number}/comments`,
      token
    );
    console.log(
      JSON.stringify(
        {
          number: issue.number,
          state: issue.state,
          title: issue.title,
          labels: (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          html_url: issue.html_url,
          body: issue.body,
          comments: comments.map((c) => ({
            id: c.id,
            user: c.user?.login,
            created_at: c.created_at,
            body: c.body,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'create') {
    const rawTitle = resolveTextArg(args.title);
    const rawBody = resolveTextArg(args.body);
    if (!rawTitle || !rawBody) {
      throw new Error(
        'Usage: gh-pm-issue.mjs create --title "<title>" --body "<markdown_or_@file>" [--labels "l1,l2"] [--force]'
      );
    }

    const formattedTitle = rawTitle.startsWith('[PM Agent]')
      ? rawTitle
      : `[PM Agent] ${rawTitle.replace(/^\[PM\]\s*/i, '')}`;

    // Always check existing open issues first to avoid duplicates
    const openIssues = await githubRequest(
      'GET',
      `/repos/${repo}/issues?state=open&per_page=100`,
      token
    );
    const targetNorm = normalizeTitleForDedup(formattedTitle);
    const duplicate = openIssues
      .filter((item) => !item.pull_request)
      .find((item) => normalizeTitleForDedup(item.title) === targetNorm);

    if (duplicate && !args.force) {
      console.log(
        JSON.stringify(
          {
            skipped_duplicate: true,
            existing_issue_number: duplicate.number,
            existing_issue_title: duplicate.title,
            existing_issue_url: duplicate.html_url,
            message:
              'An open issue with an identical normalized title already exists. Pass --force or comment on the existing issue instead.',
          },
          null,
          2
        )
      );
      return;
    }

    const labels = args.labels
      ? String(args.labels)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const created = await githubRequest('POST', `/repos/${repo}/issues`, token, {
      title: formattedTitle,
      body: wrapPmBody(rawBody),
      ...(labels && labels.length > 0 ? { labels } : {}),
    });

    console.log(
      JSON.stringify(
        {
          created: true,
          number: created.number,
          title: created.title,
          html_url: created.html_url,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'edit') {
    const number = args._[1];
    const rawBody = resolveTextArg(args.body);
    const rawTitle = resolveTextArg(args.title);
    const labels = args.labels
      ? String(args.labels)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    if (!number || (!rawBody && !rawTitle && !labels)) {
      throw new Error(
        'Usage: gh-pm-issue.mjs edit <issue_number> [--title "<title>"] [--body "<markdown_or_@file>"] [--labels "l1,l2"]'
      );
    }
    const payload = {};
    if (rawTitle) {
      payload.title = rawTitle.startsWith('[PM Agent]')
        ? rawTitle
        : `[PM Agent] ${rawTitle.replace(/^\[PM\]\s*/i, '')}`;
    }
    if (rawBody) {
      payload.body = wrapPmBody(rawBody);
    }
    if (labels) {
      payload.labels = labels;
    }
    const updated = await githubRequest(
      'PATCH',
      `/repos/${repo}/issues/${number}`,
      token,
      payload
    );
    console.log(
      JSON.stringify(
        {
          edited: true,
          number: updated.number,
          title: updated.title,
          labels: (updated.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
          html_url: updated.html_url,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'comment') {
    const number = args._[1];
    const rawBody = resolveTextArg(args.body);
    if (!number || !rawBody) {
      throw new Error('Usage: gh-pm-issue.mjs comment <issue_number> --body "<markdown_or_@file>"');
    }
    const created = await githubRequest(
      'POST',
      `/repos/${repo}/issues/${number}/comments`,
      token,
      {
        body: wrapPmBody(rawBody),
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

  if (command === 'close') {
    const number = args._[1];
    if (!number) {
      throw new Error('Usage: gh-pm-issue.mjs close <issue_number> [--comment "<markdown>"]');
    }
    if (args.comment) {
      await githubRequest('POST', `/repos/${repo}/issues/${number}/comments`, token, {
        body: wrapPmBody(resolveTextArg(args.comment)),
      });
    }
    const closed = await githubRequest('PATCH', `/repos/${repo}/issues/${number}`, token, {
      state: 'closed',
    });
    console.log(
      JSON.stringify(
        {
          closed: true,
          number: closed.number,
          state: closed.state,
          html_url: closed.html_url,
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown subcommand "${command}". Use: list, view, create, comment, or close.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
