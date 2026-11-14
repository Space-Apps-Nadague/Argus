#!/usr/bin/env node
/**
 * ARGUS Product Manager (PM) Agent — Miro Workspace & Kanban Board CLI Utility
 *
 * Reads MIRO_ACCESS_TOKEN and MIRO_BOARD_ID from process.env or .env
 * (repo root .env / ~/.env) and interacts with the Miro REST API v2 to:
 *   1. List accessible boards in the Miro workspace (`boards`)
 *   2. View current tasks, cards, frames/columns, and statuses on the board (`list`)
 *   3. Create new Kanban tasks/cards linked to GitHub Issues (`create-task`)
 *   4. Update task status/column/description (`update-task`)
 *
 * Usage:
 *   node .agents/skills/pm-agent/scripts/miro-pm-board.mjs boards
 *   node .agents/skills/pm-agent/scripts/miro-pm-board.mjs list [--board <id_or_url>]
 *   node .agents/skills/pm-agent/scripts/miro-pm-board.mjs create-task --title "<title>" [--description "<text>"] [--issue-url "<url>"] [--issue-number <n>] [--status "todo|in_progress|done"] [--parent-id "<frame_id>"]
 *   node .agents/skills/pm-agent/scripts/miro-pm-board.mjs update-task <item_id> [--status "todo|in_progress|done"] [--title "<title>"] [--description "<text>"]
 */

import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      // Ignore unreadable file
    }
  }
}

function normalizeBoardId(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const urlMatch = trimmed.match(/miro\.com\/app\/board\/([^/?#]+)/i);
  if (urlMatch && urlMatch[1]) {
    return decodeURIComponent(urlMatch[1]);
  }
  return trimmed;
}

function getMiroCredentials(explicitBoard) {
  loadDotEnvFiles();
  const token = (process.env.MIRO_ACCESS_TOKEN || '').trim();
  const boardId = normalizeBoardId(explicitBoard || process.env.MIRO_BOARD_ID || '');
  if (!token) {
    throw new Error(
      'MIRO_ACCESS_TOKEN is not configured in environment variables, .env, or ~/.env.'
    );
  }
  return { token, boardId };
}

function miroRequest(method, apiPath, token, payload = null) {
  return new Promise((resolve, reject) => {
    const bodyString = payload ? JSON.stringify(payload) : null;
    const req = https.request(
      {
        hostname: 'api.miro.com',
        path: apiPath,
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'ARGUS-PM-Agent/1.0',
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
                `Miro API ${method} ${apiPath} failed (${res.statusCode}): ${
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

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STATUS_STYLE = {
  todo: { fillColor: '#2d9bf0', statusLabel: 'TO DO' },
  in_progress: { fillColor: '#fac710', statusLabel: 'IN PROGRESS' },
  done: { fillColor: '#8fd14f', statusLabel: 'DONE' },
  blocked: { fillColor: '#f24726', statusLabel: 'BLOCKED' },
};

async function fetchAllBoardItems(boardId, token) {
  const items = [];
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const query = `?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await miroRequest(
      'GET',
      `/v2/boards/${encodeURIComponent(boardId)}/items${query}`,
      token
    );
    if (Array.isArray(res.data)) {
      items.push(...res.data);
    }
    if (!res.cursor) break;
    cursor = res.cursor;
  }
  return items;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'list';
  const { token, boardId } = getMiroCredentials(args.board);

  if (command === 'boards') {
    const res = await miroRequest('GET', '/v2/boards?limit=50', token);
    const boards = (res.data || []).map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description || '',
      viewLink: b.viewLink,
      modifiedAt: b.modifiedAt,
    }));
    console.log(JSON.stringify({ total: boards.length, boards }, null, 2));
    return;
  }

  if (!boardId) {
    throw new Error(
      'MIRO_BOARD_ID is not set. Add MIRO_BOARD_ID=<board_id> to .env or environment variables, or run `boards` to list available boards.'
    );
  }

  if (command === 'list') {
    const allItems = await fetchAllBoardItems(boardId, token);
    const frames = {};
    for (const item of allItems) {
      if (item.type === 'frame') {
        frames[item.id] = item.data?.title || 'Untitled Frame';
      }
    }

    const tasks = allItems
      .filter((item) => ['card', 'app_card', 'sticky_note'].includes(item.type))
      .map((item) => {
        const title = stripHtml(item.data?.title || item.data?.content || '');
        const description = stripHtml(item.data?.description || '');
        const rawHtml = `${item.data?.title || ''} ${item.data?.description || ''} ${
          item.data?.content || ''
        }`;
        const ghMatch = rawHtml.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/i);
        const parentFrame = item.parent?.id ? frames[item.parent.id] || item.parent.id : null;
        return {
          id: item.id,
          type: item.type,
          title,
          description,
          status: item.data?.status || parentFrame || 'unassigned',
          parentFrameId: item.parent?.id || null,
          parentFrameTitle: parentFrame,
          linkedGithubIssue: ghMatch ? Number(ghMatch[1]) : null,
          position: item.position
            ? { x: Math.round(item.position.x || 0), y: Math.round(item.position.y || 0) }
            : null,
          modifiedAt: item.modifiedAt,
        };
      });

    console.log(
      JSON.stringify(
        {
          boardId,
          frames: Object.entries(frames).map(([id, title]) => ({ id, title })),
          totalTasks: tasks.length,
          tasks,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'create-task') {
    const rawTitle = args.title;
    if (!rawTitle) {
      throw new Error(
        'Usage: miro-pm-board.mjs create-task --title "<title>" [--description "<text>"] [--issue-url "<url>"] [--issue-number <n>] [--status "todo|in_progress|done"] [--parent-id "<frame_id>"]'
      );
    }
    const statusKey = String(args.status || 'todo')
      .toLowerCase()
      .replace('-', '_');
    const styleMeta = STATUS_STYLE[statusKey] || STATUS_STYLE.todo;

    const prefixedTitle = rawTitle.startsWith('[PM Agent]')
      ? rawTitle
      : `[PM Agent] [${styleMeta.statusLabel}] ${rawTitle}`;

    const descParts = [];
    if (args['issue-url']) {
      const label = args['issue-number']
        ? `GitHub Issue #${args['issue-number']}`
        : args['issue-url'];
      descParts.push(`<p><strong>🔗 Issue:</strong> <a href="${args['issue-url']}">${label}</a></p>`);
    }
    if (args.description) {
      descParts.push(`<p>${String(args.description).replace(/\n/g, '<br/>')}</p>`);
    }
    descParts.push(`<p><em>Filed by ARGUS PM Agent • Status: ${styleMeta.statusLabel}</em></p>`);

    const payload = {
      data: {
        title: prefixedTitle,
        description: descParts.join(''),
      },
      style: {
        cardTheme: styleMeta.fillColor,
      },
      ...(args['parent-id']
        ? {
            parent: { id: String(args['parent-id']) },
          }
        : {}),
      ...(args.x || args.y
        ? {
            position: {
              x: Number(args.x || 0),
              y: Number(args.y || 0),
            },
          }
        : {}),
    };

    const created = await miroRequest(
      'POST',
      `/v2/boards/${encodeURIComponent(boardId)}/cards`,
      token,
      payload
    );

    console.log(
      JSON.stringify(
        {
          created: true,
          boardId,
          itemId: created.id,
          title: created.data?.title,
          status: styleMeta.statusLabel,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'update-task') {
    const itemId = args._[1];
    if (!itemId) {
      throw new Error(
        'Usage: miro-pm-board.mjs update-task <item_id> [--status "todo|in_progress|done"] [--title "<title>"] [--description "<text>"]'
      );
    }
    const statusKey = args.status
      ? String(args.status).toLowerCase().replace('-', '_')
      : null;
    const styleMeta = statusKey ? STATUS_STYLE[statusKey] : null;

    const payload = {};
    if (args.title || args.description) {
      payload.data = {};
      if (args.title) payload.data.title = args.title;
      if (args.description) payload.data.description = args.description;
    }
    if (styleMeta) {
      payload.style = { cardTheme: styleMeta.fillColor };
    }
    if (args['parent-id']) {
      payload.parent = { id: String(args['parent-id']) };
    }

    const updated = await miroRequest(
      'PATCH',
      `/v2/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(itemId)}`,
      token,
      payload
    );

    console.log(
      JSON.stringify(
        {
          updated: true,
          boardId,
          itemId: updated.id,
          title: updated.data?.title,
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(
    `Unknown subcommand "${command}". Use: boards, list, create-task, or update-task.`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
