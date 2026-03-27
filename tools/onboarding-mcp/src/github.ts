export const REPO = "microsoft/vscode-cmake-tools";
export const REPO_URL = `https://github.com/${REPO}`;
const API_BASE = `https://api.github.com/repos/${REPO}`;

export class GitHubApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly statusText: string,
        public readonly body: string
    ) {
        const isRateLimit = status === 403 && body.includes("rate limit");
        const message = isRateLimit
            ? `GitHub API rate limit exceeded (HTTP ${status}). ` +
              `Unauthenticated requests are limited to 60/hour. ` +
              `Set the GITHUB_TOKEN environment variable to increase the limit to 5,000/hour. ` +
              `You can create a personal access token at https://github.com/settings/tokens (no scopes needed for public repos).`
            : `GitHub API error: HTTP ${status} ${statusText} — ${body}`;
        super(message);
        this.name = "GitHubApiError";
    }
}

/**
 * Perform a GET request to the GitHub REST API for the cmake-tools repo.
 * @param path  API path relative to the repo, e.g. "/issues?state=open"
 * @returns     Parsed JSON response body.
 */
export async function githubGet<T>(path: string): Promise<T> {
    const url = `${API_BASE}${path}`;

    const headers: Record<string, string> = {
        "User-Agent": "cmake-tools-onboarding-mcp",
        "Accept": "application/vnd.github+json"
    };

    const token = process.env.GITHUB_TOKEN;
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
        const body = await response.text();
        throw new GitHubApiError(response.status, response.statusText, body);
    }

    return (await response.json()) as T;
}
