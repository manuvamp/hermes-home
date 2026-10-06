/**
 * GitHub — minimal REST adapter for triage (spec §43).
 *
 * Uses the classic REST API so no SDK or auth app setup is needed —
 * just a Personal Access Token scoped `repo`.
 *
 * Read-only for the MVP: listing and summarizing issues. The point is
 * proving the adapter pattern; write actions belong in a follow-up.
 */
import { config } from '../config.js';

export type GithubIssue = {
  number: number;
  title: string;
  repo: string;
  url: string;
  labels: string[];
  updatedAt: string;
  state: 'open' | 'closed';
};

const API = 'https://api.github.com';
const TIMEOUT_MS = 8_000;

export function githubConfigured(): boolean {
  return Boolean(config.github.token && config.github.user);
}

async function gh<T>(path: string): Promise<T> {
  if (!githubConfigured()) {
    throw new Error('GitHub not configured — set GITHUB_TOKEN and GITHUB_USER in .env');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        authorization: `Bearer ${config.github.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'hermes-home/0.1',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub ${path} → HTTP ${res.status}: ${text.slice(0, 160)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

type ApiIssue = {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  state: 'open' | 'closed';
  labels: Array<{ name: string } | string>;
  repository_url?: string;
  pull_request?: unknown;
};

function normalize(i: ApiIssue): GithubIssue {
  const repo =
    i.repository_url?.replace(`${API.replace('https://', 'https://api.')}/repos/`, '') ??
    i.html_url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+).*$/, '$1');
  return {
    number: i.number,
    title: i.title,
    repo: repo ?? 'unknown',
    url: i.html_url,
    labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
    updatedAt: i.updated_at,
    state: i.state,
  };
}

/** Issues assigned to the configured user, across repos, newest first. */
export async function listMyOpenIssues(limit = 10): Promise<GithubIssue[]> {
  const query = encodeURIComponent(
    `assignee:${config.github.user} is:issue is:open`,
  );
  const data = await gh<{ items: ApiIssue[] }>(
    `/search/issues?q=${query}&per_page=${Math.min(limit, 30)}&sort=updated&order=desc`,
  );
  return (data.items ?? []).filter((i) => !i.pull_request).slice(0, limit).map(normalize);
}

/** Issues for one repo (owner/name). */
export async function listRepoIssues(
  repo: string,
  limit = 10,
): Promise<GithubIssue[]> {
  const issues = await gh<ApiIssue[]>(
    `/repos/${repo}/issues?state=open&per_page=${Math.min(limit, 30)}`,
  );
  return issues
    .filter((i) => !i.pull_request)
    .slice(0, limit)
    .map((i) => normalize({ ...i, repository_url: `${API}/repos/${repo}` }));
}
