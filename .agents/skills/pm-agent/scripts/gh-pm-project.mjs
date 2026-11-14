#!/usr/bin/env node
/**
 * ARGUS Product Manager (PM) Agent — GitHub Projects v2 Kanban CLI Utility
 *
 * Uses GitHub's GraphQL API (`https://api.github.com/graphql`) to list and sync
 * GitHub Issues onto a GitHub Projects v2 Kanban board (Todo / In Progress / Done).
 *
 * Authentication order:
 *   1. GH_PROJECT_TOKEN (recommended for GitHub Actions when syncing org/user Projects v2)
 *   2. GITHUB_TOKEN / GH_TOKEN
 *   3. Local git credential helper (`git credential fill`)
 *
 * Configuration:
 *   - GITHUB_PROJECT_NUMBER: Numeric project number (e.g. from /orgs/<org>/projects/<N> or /users/<user>/projects/<N>)
 *   - GITHUB_PROJECT_OWNER: Optional org/user login (defaults to repo owner, e.g. Space-Apps-Nadague)
 *
 * Usage:
 *   node .agents/skills/pm-agent/scripts/gh-pm-project.mjs list [--project <number>] [--owner <login>]
 *   node .agents/skills/pm-agent/scripts/gh-pm-project.mjs sync-issue --issue-number <n> --status "backlog|todo|urgent|in_progress|done" [--priority "P0|P1|P2"] [--project <number>] [--owner <login>]
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

function getRepoSlug() {
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

function getToken() {
  if (process.env.GH_PROJECT_TOKEN) return process.env.GH_PROJECT_TOKEN.trim();
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
    // Ignore
  }

  throw new Error(
    'Unable to find GitHub token. Set GH_PROJECT_TOKEN or GITHUB_TOKEN.'
  );
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

function githubGraphql(query, variables, token) {
  return new Promise((resolve, reject) => {
    const bodyString = JSON.stringify({ query, variables });
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: '/graphql',
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'ARGUS-PM-Agent/1.0',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyString),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            return reject(new Error(`Invalid GraphQL JSON response (${res.statusCode}): ${data}`));
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            if (Array.isArray(parsed.errors) && parsed.errors.length > 0 && !parsed.data) {
              return reject(
                new Error(`GitHub GraphQL error: ${parsed.errors.map((e) => e.message).join('; ')}`)
              );
            }
            resolve(parsed);
          } else {
            reject(
              new Error(
                `GitHub GraphQL failed (${res.statusCode}): ${JSON.stringify(parsed)}`
              )
            );
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyString);
    req.end();
  });
}

async function fetchProjectMetadata(owner, projectNumber, token) {
  const query = `
    query($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) {
          id
          title
          url
          fields(first: 25) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
          items(first: 50) {
            nodes {
              id
              fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  optionId
                }
              }
              priorityValue: fieldValueByName(name: "Priority") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  optionId
                }
              }
              content {
                ... on Issue {
                  id
                  number
                  title
                  state
                  url
                }
              }
            }
          }
        }
      }
      user(login: $owner) {
        projectV2(number: $number) {
          id
          title
          url
          fields(first: 25) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
          items(first: 50) {
            nodes {
              id
              fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  optionId
                }
              }
              priorityValue: fieldValueByName(name: "Priority") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  optionId
                }
              }
              content {
                ... on Issue {
                  id
                  number
                  title
                  state
                  url
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await githubGraphql(query, { owner, number: projectNumber }, token);
  const project = res.data?.organization?.projectV2 || res.data?.user?.projectV2;
  if (!project) {
    const errMsg = Array.isArray(res.errors)
      ? res.errors.map((e) => e.message).join('; ')
      : 'Project not found or token lacks read:project/project scope.';
    throw new Error(`Unable to load GitHub Project #${projectNumber} for "${owner}": ${errMsg}`);
  }
  return project;
}

const STATUS_ALIASES = {
  backlog: ['backlog', 'not urgent', 'later'],
  todo: ['todo', 'to do', 'regular', 'ready'],
  urgent: ['urgent', 'p0', 'high', 'critical'],
  'in progress': ['in progress', 'doing', 'active'],
  done: ['done', 'completed', 'closed'],
};

const PRIORITY_ALIASES = {
  p0: ['p0', 'urgent', 'critical', 'high'],
  p1: ['p1', 'medium', 'normal', 'regular'],
  p2: ['p2', 'low', 'backlog'],
};

function resolveSingleSelectOption(project, fieldName, desiredValue, aliasMap) {
  const fields = project.fields?.nodes || [];
  const targetField = fields.find(
    (f) => f && f.name && f.name.toLowerCase() === fieldName.toLowerCase() && Array.isArray(f.options)
  );
  if (!targetField) return { fieldId: null, option: null, availableOptions: [] };

  const normalized = String(desiredValue || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .trim();

  const candidates = aliasMap[normalized] || [normalized];
  let option = null;
  for (const candidate of candidates) {
    option =
      targetField.options.find((o) => o.name.toLowerCase() === candidate) ||
      targetField.options.find((o) => o.name.toLowerCase().includes(candidate));
    if (option) break;
  }

  return {
    fieldId: targetField.id,
    option,
    availableOptions: targetField.options.map((o) => o.name),
  };
}

async function main() {
  loadDotEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'list';
  const repoSlug = getRepoSlug();
  const [repoOwner, repoName] = repoSlug.split('/');
  const projectOwner = (
    args.owner ||
    process.env.PM_PROJECT_OWNER ||
    process.env.GITHUB_PROJECT_OWNER ||
    repoOwner
  ).trim();
  const projectNumberRaw =
    args.project || process.env.PM_PROJECT_NUMBER || process.env.GITHUB_PROJECT_NUMBER || '';
  const projectNumber = Number(projectNumberRaw);

  if (!projectNumberRaw || Number.isNaN(projectNumber) || projectNumber <= 0) {
    throw new Error(
      'PM_PROJECT_NUMBER is not set. Set PM_PROJECT_NUMBER=<number> (or pass --project <number>).'
    );
  }

  const token = getToken();

  if (command === 'list') {
    const project = await fetchProjectMetadata(projectOwner, projectNumber, token);
    const hasPriorityField = (project.fields?.nodes || []).some(
      (f) => f?.name?.toLowerCase() === 'priority' && Array.isArray(f.options) && f.options.length > 0
    );
    const items = (project.items?.nodes || [])
      .filter((item) => item.content?.number)
      .map((item) => ({
        itemId: item.id,
        status: item.fieldValueByName?.name || 'Unassigned',
        priority: item.priorityValue?.name || 'Unassigned',
        issueNumber: item.content.number,
        title: item.content.title,
        state: item.content.state,
        url: item.content.url,
      }));

    console.log(
      JSON.stringify(
        {
          projectId: project.id,
          projectNumber,
          projectOwner,
          title: project.title,
          url: project.url,
          hasPriorityField,
          totalItems: items.length,
          items,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'sync-issue') {
    const issueNumber = Number(args['issue-number'] || args._[1]);
    const desiredStatus = args.status || 'todo';
    if (!issueNumber || Number.isNaN(issueNumber)) {
      throw new Error(
        'Usage: gh-pm-project.mjs sync-issue --issue-number <n> --status "todo|in_progress|done"'
      );
    }

    const issueRes = await githubGraphql(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id
            number
            title
            url
          }
        }
      }`,
      { owner: repoOwner, repo: repoName, number: issueNumber },
      token
    );

    const issueNode = issueRes.data?.repository?.issue;
    if (!issueNode) {
      throw new Error(`Issue #${issueNumber} not found in ${repoSlug}.`);
    }

    const project = await fetchProjectMetadata(projectOwner, projectNumber, token);

    const addRes = await githubGraphql(
      `mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }`,
      { projectId: project.id, contentId: issueNode.id },
      token
    );

    const itemId = addRes.data?.addProjectV2ItemById?.item?.id;
    if (!itemId) {
      throw new Error(
        `Failed to add issue #${issueNumber} to Project #${projectNumber}: ${JSON.stringify(addRes.errors || addRes)}`
      );
    }

    const statusMatch = resolveSingleSelectOption(
      project,
      'Status',
      desiredStatus,
      STATUS_ALIASES
    );
    let updatedStatus = null;

    if (statusMatch.fieldId && statusMatch.option) {
      await githubGraphql(
        `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { singleSelectOptionId: $optionId }
            }
          ) {
            projectV2Item {
              id
            }
          }
        }`,
        {
          projectId: project.id,
          itemId,
          fieldId: statusMatch.fieldId,
          optionId: statusMatch.option.id,
        },
        token
      );
      updatedStatus = statusMatch.option.name;
    }

    let updatedPriority = null;
    if (args.priority) {
      const priorityMatch = resolveSingleSelectOption(
        project,
        'Priority',
        args.priority,
        PRIORITY_ALIASES
      );
      if (priorityMatch.fieldId && priorityMatch.option) {
        await githubGraphql(
          `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
            updateProjectV2ItemFieldValue(
              input: {
                projectId: $projectId
                itemId: $itemId
                fieldId: $fieldId
                value: { singleSelectOptionId: $optionId }
              }
            ) {
              projectV2Item {
                id
              }
            }
          }`,
          {
            projectId: project.id,
            itemId,
            fieldId: priorityMatch.fieldId,
            optionId: priorityMatch.option.id,
          },
          token
        );
        updatedPriority = priorityMatch.option.name;
      } else {
        updatedPriority = `Unchanged (no Priority option matching "${args.priority}"; available: ${(priorityMatch.availableOptions || []).join(', ') || 'none'})`;
      }
    }

    console.log(
      JSON.stringify(
        {
          synced: true,
          projectNumber,
          projectUrl: project.url,
          issueNumber,
          itemId,
          status:
            updatedStatus ||
            `Unchanged (no Status option matching "${desiredStatus}"; available: ${(statusMatch.availableOptions || []).join(', ')})`,
          ...(args.priority ? { priority: updatedPriority } : {}),
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown subcommand "${command}". Use: list or sync-issue.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
