import type { User } from './types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const ACCESS_KEY = 'bookit.access';
const REFRESH_KEY = 'bookit.refresh';
const USER_KEY = 'bookit.user';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Tokens live in localStorage to keep this demo simple. In production, prefer httpOnly cookies set by the API.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the session just will not persist */
  }
}

export const session = {
  user: (): User | null => {
    const raw = read(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  },
  save(tokens: { accessToken: string; refreshToken: string }, user?: User) {
    write(ACCESS_KEY, tokens.accessToken);
    write(REFRESH_KEY, tokens.refreshToken);
    if (user) write(USER_KEY, JSON.stringify(user));
  },
  clear() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
    write(USER_KEY, null);
  },
  refreshToken: () => read(REFRESH_KEY),
};

// Refresh tokens work once, so parallel 401s must share one refresh call.
let refreshing: Promise<boolean> | null = null;
function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = read(REFRESH_KEY);
    if (!refreshToken) return false;
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      session.clear();
      return false;
    }
    session.save(await res.json());
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const access = read(ACCESS_KEY);
  if (access) headers.set('Authorization', `Bearer ${access}`);

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers });
  } catch {
    // The browser hides the reason (server down, wrong URL or CORS), so say what to check.
    throw new ApiError(0, `Cannot reach the API at ${API}. Is it running, and does CORS_ORIGINS include this site?`);
  }
  if (res.status === 401 && retry && (await refreshTokens())) {
    return request<T>(path, init, false);
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? message);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}
