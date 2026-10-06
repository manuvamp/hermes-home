/**
 * GitHub tools (spec §43) — read-only triage.
 *
 * github_my_issues   — open issues assigned to the configured user
 * github_repo_issues — open issues for a specific repo
 */
import { z } from 'zod';
import type { RegisteredTool } from './registry.js';
import {
  githubConfigured,
  listMyOpenIssues,
  listRepoIssues,
} from '../state/github.js';

const RepoInput = z.object({
  repo: z.string().describe('Repo as owner/name, e.g. anthropic/claude'),
  limit: z.number().int().min(1).max(30).optional(),
});

const LIMIT_CAP = 10;

function unavailable(): Record<string, unknown> {
  return {
    success: false,
    error: 'GitHub not configured yet — set GITHUB_TOKEN and GITHUB_USER in .env.',
  };
}

function summarize(issues: ReturnType<typeof shape>[]) {
  return { count: issues.length, issues };
}

function shape(i: {
  number: number;
  title: string;
  repo: string;
  labels: string[];
  updatedAt: string;
}) {
  return {
    repo: i.repo,
    number: i.number,
    title: i.title,
    labels: i.labels,
    updatedAt: i.updatedAt,
  };
}

export const githubTools: RegisteredTool[] = [
  {
    name: 'github_my_issues',
    title: 'My open GitHub issues',
    description:
      "List open GitHub issues assigned to the user, newest activity first. Use for 'what should I work on', 'what issues do I have open', 'triage my GitHub'.",
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      if (!githubConfigured()) return unavailable();
      const issues = (await listMyOpenIssues(LIMIT_CAP)).map(shape);
      return { success: true, source: 'github', ...summarize(issues) };
    },
  },
  {
    name: 'github_repo_issues',
    title: 'Repo issues',
    description: 'List open issues for a specific GitHub repository (owner/name).',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        limit: { type: 'number', description: 'Max (default 10, cap 30)' },
      },
      required: ['repo'],
    },
    handler: async (input) => {
      if (!githubConfigured()) return unavailable();
      const { repo, limit } = RepoInput.parse(input);
      const issues = (await listRepoIssues(repo, limit ?? LIMIT_CAP)).map(shape);
      return { success: true, source: 'github', repo, ...summarize(issues) };
    },
  },
];
