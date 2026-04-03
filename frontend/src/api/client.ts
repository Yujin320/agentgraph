import axios from 'axios';

function getToken(): string {
  const ls = localStorage.getItem('access_token');
  if (ls) return ls;
  const match = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

// ────────────────────────────────────────────────────────────
// SSE helper — uses fetch so we can pass Bearer token in headers.
// EventSource doesn't support custom headers, so we pass token
// both as a header AND as a query param for middleware compatibility.
// ────────────────────────────────────────────────────────────

export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

export function fetchSSE(
  url: string,
  body: object,
  onEvent: (event: SSEEvent) => void,
  onDone?: () => void,
  onError?: (err: Error) => void,
): () => void {
  const token = getToken();
  const abortController = new AbortController();

  const fullUrl = `/api${url}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: abortController.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        onError?.(new Error(`HTTP ${response.status}: ${response.statusText}`));
        return;
      }
      if (!response.body) {
        onError?.(new Error('Response body is null'));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep incomplete last line in buffer
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw) as SSEEvent;
              onEvent(parsed);
              if (parsed.type === 'done') {
                onDone?.();
                return;
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      onDone?.();
    })
    .catch((err: Error) => {
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    });

  // Return cancel function
  return () => abortController.abort();
}
