import { maskSecret } from './protocolSchema.ts';

export interface GithubCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface GithubPrInfo {
  number: number;
  title: string;
  state: string;
  author: string;
  headBranch: string;
  updatedAt: string;
  url: string;
}

export interface GithubOverview {
  configured: boolean;
  repo: string;
  defaultBranch?: string;
  visibility?: string;
  openIssues?: number;
  stars?: number;
  htmlUrl?: string;
  branches: string[];
  commits: GithubCommitInfo[];
  pullRequests: GithubPrInfo[];
  fetchedAt: string;
  error?: string;
}

function getGithubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Vanguard-SRE-Control-Plane/2.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function getGithubIntegrationStatus() {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_DEFAULT_REPO?.trim() || '';
  return {
    configured: Boolean(token && repo && repo.includes('/')),
    hasToken: Boolean(token),
    maskedToken: maskSecret(token),
    defaultRepo: repo || null,
  };
}

export async function testGithubConnection(): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
  repo?: string;
}> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_DEFAULT_REPO?.trim() || '';
  if (!token) {
    return {
      ok: false,
      latencyMs: 0,
      message: 'Переменная окружения GITHUB_TOKEN не задана на сервере.',
    };
  }

  const t0 = Date.now();
  const targetUrl =
    repo && repo.includes('/')
      ? `https://api.github.com/repos/${repo}`
      : 'https://api.github.com/user';

  try {
    const resp = await fetch(targetUrl, { headers: getGithubHeaders() });
    const latencyMs = Date.now() - t0;
    if (!resp.ok) {
      return {
        ok: false,
        latencyMs,
        message: `GitHub API вернул HTTP ${resp.status}`,
        repo: repo || undefined,
      };
    }
    const data = (await resp.json()) as { full_name?: string; login?: string; default_branch?: string };
    return {
      ok: true,
      latencyMs,
      repo: data.full_name || repo || undefined,
      message: data.full_name
        ? `Подключён репозиторий ${data.full_name} (ветка ${data.default_branch || 'main'})`
        : `Токен валиден (аккаунт ${data.login || 'authenticated'})`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      message: err instanceof Error ? err.message : 'Сетевая ошибка GitHub API',
    };
  }
}

export async function getGithubOverview(repoOverride?: string): Promise<GithubOverview> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = (repoOverride || process.env.GITHUB_DEFAULT_REPO || '').trim();
  const fetchedAt = new Date().toISOString();

  if (!token || !repo || !repo.includes('/')) {
    return {
      configured: false,
      repo: repo || 'не задан',
      branches: [],
      commits: [],
      pullRequests: [],
      fetchedAt,
      error: !token
        ? 'Задайте GITHUB_TOKEN и GITHUB_DEFAULT_REPO в переменных окружения.'
        : 'Укажите GITHUB_DEFAULT_REPO в формате owner/repo.',
    };
  }

  const headers = getGithubHeaders();
  try {
    const [repoRes, commitsRes, branchesRes, prsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}`, { headers }),
      fetch(`https://api.github.com/repos/${repo}/commits?per_page=8`, { headers }),
      fetch(`https://api.github.com/repos/${repo}/branches?per_page=10`, { headers }),
      fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=6`, { headers }),
    ]);

    if (!repoRes.ok) {
      return {
        configured: true,
        repo,
        branches: [],
        commits: [],
        pullRequests: [],
        fetchedAt,
        error: `Не удалось прочитать репозиторий ${repo} (HTTP ${repoRes.status})`,
      };
    }

    const repoData = (await repoRes.json()) as {
      default_branch?: string;
      visibility?: string;
      open_issues_count?: number;
      stargazers_count?: number;
      html_url?: string;
    };

    const rawCommits = commitsRes.ok
      ? ((await commitsRes.json()) as Array<{
          sha: string;
          html_url: string;
          commit?: { message?: string; author?: { name?: string; date?: string } };
        }>)
      : [];

    const rawBranches = branchesRes.ok
      ? ((await branchesRes.json()) as Array<{ name: string }>)
      : [];

    const rawPrs = prsRes.ok
      ? ((await prsRes.json()) as Array<{
          number: number;
          title: string;
          state: string;
          html_url: string;
          updated_at: string;
          user?: { login?: string };
          head?: { ref?: string };
        }>)
      : [];

    return {
      configured: true,
      repo,
      defaultBranch: repoData.default_branch,
      visibility: repoData.visibility,
      openIssues: repoData.open_issues_count,
      stars: repoData.stargazers_count,
      htmlUrl: repoData.html_url,
      branches: rawBranches.map((b) => b.name),
      commits: rawCommits.map((c) => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 12),
        message: (c.commit?.message || '').split('\n')[0].slice(0, 120),
        author: c.commit?.author?.name || 'unknown',
        date: c.commit?.author?.date || '',
        url: c.html_url,
      })),
      pullRequests: rawPrs.map((pr) => ({
        number: pr.number,
        title: pr.title.slice(0, 120),
        state: pr.state,
        author: pr.user?.login || 'unknown',
        headBranch: pr.head?.ref || '',
        updatedAt: pr.updated_at,
        url: pr.html_url,
      })),
      fetchedAt,
    };
  } catch (err) {
    return {
      configured: true,
      repo,
      branches: [],
      commits: [],
      pullRequests: [],
      fetchedAt,
      error: err instanceof Error ? err.message : 'Ошибка GitHub API',
    };
  }
}

export async function getLatestRepoCommitSha(): Promise<{ sha: string; url: string } | null> {
  const status = getGithubIntegrationStatus();
  if (!status.configured || !status.defaultRepo) return null;
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${status.defaultRepo}/commits?per_page=1`,
      { headers: getGithubHeaders() }
    );
    if (!resp.ok) return null;
    const list = (await resp.json()) as Array<{ sha?: string; html_url?: string }>;
    if (list[0]?.sha) {
      return { sha: list[0].sha, url: list[0].html_url || '' };
    }
    return null;
  } catch {
    return null;
  }
}
