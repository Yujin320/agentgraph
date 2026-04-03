import { useState, useCallback, useRef } from 'react';
import { fetchSSE } from '../api/client';
import type { ChatMsg, ChatSteps, ReasoningStepData } from '../components/ChatMessage';

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

export function useChat(workspace: string) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const logIdRef = useRef<string | null>(null);

  const updateAssistant = useCallback((updater: (msg: ChatMsg) => ChatMsg) => {
    setMessages((prev) => {
      const next = [...prev];
      const lastIdx = next.length - 1;
      next[lastIdx] = updater(next[lastIdx]);
      return next;
    });
  }, []);

  const sendMessage = useCallback(
    (question: string) => {
      const userMsg: ChatMsg = { role: 'user', content: question };
      const assistantMsg: ChatMsg = {
        role: 'assistant',
        content: '',
        loading: true,
        steps: {},
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setLoading(true);

      fetchSSE(
        `/workspaces/${workspace}/chat`,
        { question, session_id: sessionRef.current },
        (raw: { event?: string; type?: string; data?: unknown; [key: string]: unknown }) => {
          // Support both formats:
          // New format: { event: string, data: {...} }
          // Old format: { type: string, ...rest }
          const eventName = (raw.event ?? raw.type ?? 'unknown') as string;
          const eventData = (raw.data ?? raw) as Record<string, unknown>;
          const event: SSEEvent = { event: eventName, data: eventData };

          switch (event.event) {
            case 'session':
              sessionRef.current = (event.data.session_id as string) ?? null;
              logIdRef.current = (event.data.log_id as string) ?? null;
              updateAssistant((msg) => ({ ...msg, logId: logIdRef.current ?? undefined }));
              break;
            case 'expansion':
              updateAssistant((msg) => ({
                ...msg,
                expansion: event.data as { original: string; expanded: string },
              }));
              break;
            case 'graph_context':
              updateAssistant((msg) => ({
                ...msg,
                graphContext: event.data as { tables: string[]; scenario: string; fields_count: number },
              }));
              break;
            case 'decomposition':
              updateAssistant((msg) => ({
                ...msg,
                decomposition: event.data as { steps: Array<{ step: number; question: string; purpose?: string }>; total: number },
              }));
              break;
            case 'step_start':
              updateAssistant((msg) => ({
                ...msg,
                currentStep: event.data as { step: number; total: number; question: string; purpose?: string },
              }));
              break;
            case 'step_result':
              updateAssistant((msg) => ({
                ...msg,
                stepResults: [...(msg.stepResults ?? []), event.data as { step: number; summary: string }],
              }));
              break;
            case 'step_error':
              updateAssistant((msg) => ({
                ...msg,
                stepResults: [...(msg.stepResults ?? []), { step: (event.data.step as number), summary: `错误: ${event.data.error as string}`, error: true }],
              }));
              break;
            case 'intent':
              updateAssistant((msg) => ({
                ...msg,
                intent: event.data as ChatMsg['intent'],
                steps: { ...msg.steps, intent: true } as ChatSteps,
              }));
              break;
            case 'sql': {
              const sqlStep = (event.data.step as number) || undefined;
              updateAssistant((msg) => ({
                ...msg,
                sql: event.data.sql as string,
                sqlStep,
                stepSqls: sqlStep && sqlStep > 0
                  ? { ...(msg.stepSqls ?? {}), [sqlStep]: event.data.sql as string }
                  : msg.stepSqls,
                steps: { ...msg.steps, sql: true } as ChatSteps,
              }));
              break;
            }
            case 'data':
              updateAssistant((msg) => {
                const step = event.data.step as number | undefined;
                const newData = {
                  columns: event.data.columns as string[],
                  rows: event.data.rows as unknown[][],
                };
                if (step && step > 0) {
                  const allStepData = [...(msg.multiStepData ?? []), { step, ...newData }];
                  return { ...msg, multiStepData: allStepData, steps: { ...msg.steps, data: true } as ChatSteps };
                }
                return { ...msg, tableData: newData, steps: { ...msg.steps, data: true } as ChatSteps };
              });
              break;
            case 'chart':
              updateAssistant((msg) => ({
                ...msg,
                chartSpec: event.data as Record<string, unknown>,
                steps: { ...msg.steps, chart: true } as ChatSteps,
              }));
              break;
            case 'interpretation':
              updateAssistant((msg) => ({
                ...msg,
                content: msg.content + (event.data.chunk as string),
              }));
              break;
            case 'suggestions':
              updateAssistant((msg) => ({
                ...msg,
                suggestions: (event.data.suggestions as string[]) ?? [],
              }));
              break;
            case 'reasoning_start':
              updateAssistant((msg) => ({
                ...msg,
                reasoningMode: 'causal',
                reasoningSteps: [],
              }));
              break;
            case 'reasoning_step': {
              const step = event.data as unknown as ReasoningStepData;
              updateAssistant((msg) => ({
                ...msg,
                reasoningSteps: [...(msg.reasoningSteps ?? []), step],
              }));
              break;
            }
            case 'reasoning_conclusion':
              updateAssistant((msg) => ({
                ...msg,
                reasoningConclusion: event.data as ChatMsg['reasoningConclusion'],
              }));
              break;
            case 'error':
              updateAssistant((msg) => ({
                ...msg,
                content: `查询出错: ${event.data.error as string}`,
                loading: false,
              }));
              setLoading(false);
              break;
            case 'done':
              updateAssistant((msg) => ({
                ...msg,
                loading: false,
                steps: msg.reasoningMode === 'causal'
                  ? msg.steps
                  : ({ ...msg.steps, interpret: true } as ChatSteps),
              }));
              setLoading(false);
              break;
          }
        },
        () => {
          setLoading(false);
          updateAssistant((msg) => ({ ...msg, loading: false }));
        },
        (err: unknown) => {
          console.error(err);
          updateAssistant((msg) => ({
            ...msg,
            content: '请求失败，请检查网络和令牌',
            loading: false,
          }));
          setLoading(false);
        },
      );
    },
    [updateAssistant, workspace],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    sessionRef.current = null;
  }, []);

  return { messages, loading, sendMessage, clearMessages };
}
