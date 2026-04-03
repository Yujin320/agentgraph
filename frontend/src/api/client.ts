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
// Pipeline API helpers
// ────────────────────────────────────────────────────────────

export const pipelineApi = {
  createWorkspace: (data: {
    name: string;
    db_url: string;
    title?: string;
    description?: string;
  }) => api.post('/api/workspaces', data),

  createPipeline: (ws: string) =>
    api.post(`/api/workspaces/${ws}/pipeline/create`),

  getState: (ws: string) =>
    api.get(`/api/workspaces/${ws}/pipeline`),

  runStage: (ws: string, stage: string, data?: { input?: object; config?: object }) =>
    api.post(`/api/workspaces/${ws}/pipeline/run/${stage}`, data),

  runNext: (ws: string) =>
    api.post(`/api/workspaces/${ws}/pipeline/next`),

  getResult: (ws: string, stage: string) =>
    api.get(`/api/workspaces/${ws}/pipeline/result/${stage}`),

  submitReview: (ws: string, stage: string, data: unknown) =>
    api.put(`/api/workspaces/${ws}/pipeline/review/${stage}`, { data }),

  skipStage: (ws: string, stage: string) =>
    api.post(`/api/workspaces/${ws}/pipeline/skip/${stage}`),

  listStages: () =>
    api.get('/api/pipeline/stages'),
};

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

          // Track current event name for `event:` + `data:` SSE format
          let currentEventName = '';

          for (const line of lines) {
            // Handle `event:` lines (new format)
            if (line.startsWith('event:')) {
              currentEventName = line.slice(6).trim();
              continue;
            }

            if (!line.startsWith('data: ')) {
              // Empty line resets the event name (SSE message boundary)
              if (line.trim() === '') currentEventName = '';
              continue;
            }

            const raw = line.slice(6).trim();
            if (!raw) continue;

            try {
              const parsed = JSON.parse(raw) as SSEEvent;

              // If we captured an event name from a preceding `event:` line,
              // inject it so callers get a unified { event, data } shape.
              if (currentEventName) {
                const unified = { event: currentEventName, data: parsed } as unknown as SSEEvent;
                onEvent(unified);
                if (currentEventName === 'done' || parsed.type === 'done') {
                  onDone?.();
                  return;
                }
                currentEventName = '';
              } else {
                // Old format: type field inside data object
                onEvent(parsed);
                if (parsed.type === 'done') {
                  onDone?.();
                  return;
                }
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
