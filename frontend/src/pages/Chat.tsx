import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  Layout,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  LoadingOutlined,
  SendOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import api, { fetchSSE, SSEEvent } from '../api/client';

const { Header, Sider, Content } = Layout;
const { Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;

// ── Types ──────────────────────────────────────────────────────────────────

interface ReasoningStep {
  node_id: string;
  node_label: string;
  metric_value: unknown;
  threshold: unknown;
  status: string;
  explanation: string;
  sql?: string;
  result?: { columns: string[]; rows: unknown[][]; row_count: number; error?: string };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  question?: string;
  steps: ReasoningStep[];
  currentSql?: string;
  conclusion?: string;
  chartHint?: string;
  streaming: boolean;
  error?: string;
}

interface WorkspaceInfo {
  name: string;
  title: string;
  description: string;
  current_period: string;
}

interface FewShotExample {
  question?: string;
  q?: string;
  [key: string]: unknown;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function statusBadge(status: string) {
  if (status === 'abnormal')
    return <Tag icon={<WarningOutlined />} color="error">异常</Tag>;
  if (status === 'normal')
    return <Tag icon={<CheckCircleOutlined />} color="success">正常</Tag>;
  if (status === 'error')
    return <Tag icon={<CloseCircleOutlined />} color="default">错误</Tag>;
  return <Tag color="processing">分析中</Tag>;
}

// ── StepPanel: renders one reasoning step ─────────────────────────────────

interface StepPanelProps {
  step: ReasoningStep;
  index: number;
}

const StepPanel: React.FC<StepPanelProps> = ({ step, index }) => {
  const hasResult = step.result && step.result.columns.length > 0;

  const tableColumns = hasResult
    ? step.result!.columns.map((col) => ({
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true,
      }))
    : [];

  const tableData = hasResult
    ? step.result!.rows.map((row, i) => {
        const obj: Record<string, unknown> = { _key: i };
        step.result!.columns.forEach((col, ci) => {
          obj[col] = row[ci];
        });
        return obj;
      })
    : [];

  return (
    <Panel
      key={index}
      header={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text strong style={{ minWidth: 24 }}>
            {index + 1}.
          </Text>
          <Text style={{ flex: 1 }}>{step.node_label || step.node_id}</Text>
          {step.metric_value !== undefined && step.metric_value !== null && (
            <Tooltip title="指标值">
              <Tag color="blue">{String(step.metric_value)}</Tag>
            </Tooltip>
          )}
          {step.threshold !== undefined && step.threshold !== null && (
            <Tooltip title="阈值">
              <Tag color="geekblue">阈值 {String(step.threshold)}</Tag>
            </Tooltip>
          )}
          {statusBadge(step.status)}
        </div>
      }
    >
      {step.explanation && (
        <Paragraph style={{ marginBottom: 12, color: '#555' }}>{step.explanation}</Paragraph>
      )}

      {step.sql && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            SQL
          </Text>
          <pre
            style={{
              background: '#1e1e2e',
              color: '#cdd6f4',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 12,
              overflowX: 'auto',
              margin: '4px 0 0',
            }}
          >
            {step.sql}
          </pre>
        </div>
      )}

      {step.result?.error && (
        <Alert type="error" message={step.result.error} style={{ marginBottom: 12 }} />
      )}

      {hasResult && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            查询结果 ({step.result!.row_count} 行)
          </Text>
          <Table
            size="small"
            columns={tableColumns}
            dataSource={tableData}
            rowKey="_key"
            pagination={false}
            scroll={{ x: true }}
            style={{ marginTop: 4 }}
          />
        </div>
      )}
    </Panel>
  );
};

// ── MessageBubble ──────────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ msg }) => {
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div
          style={{
            maxWidth: '80%',
            background: '#4f46e5',
            color: '#fff',
            borderRadius: '16px 16px 4px 16px',
            padding: '10px 16px',
            fontSize: 14,
          }}
        >
          {msg.question}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div style={{ marginBottom: 24 }} className="sse-fade-in">
      {/* Reasoning steps */}
      {msg.steps.length > 0 && (
        <Card
          size="small"
          title={
            <span>
              <Badge
                count={msg.steps.length}
                style={{ background: '#4f46e5' }}
                size="small"
                offset={[4, 0]}
              >
                推理步骤
              </Badge>
              {msg.streaming && (
                <LoadingOutlined style={{ marginLeft: 8, color: '#4f46e5' }} />
              )}
            </span>
          }
          style={{ marginBottom: 12, borderRadius: 10 }}
        >
          <Collapse ghost size="small">
            {msg.steps.map((step, i) => (
              <StepPanel key={step.node_id || i} step={step} index={i} />
            ))}
          </Collapse>
        </Card>
      )}

      {/* Conclusion */}
      {msg.conclusion && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e8e8e8',
            borderRadius: 10,
            padding: '14px 18px',
            fontSize: 14,
            lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
          }}
        >
          <Text strong style={{ display: 'block', marginBottom: 6, color: '#4f46e5' }}>
            归因结论
          </Text>
          {msg.conclusion}
        </div>
      )}

      {/* Still streaming with no conclusion yet */}
      {msg.streaming && !msg.conclusion && msg.steps.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#999', fontSize: 13 }}>
          <LoadingOutlined />
          <span>正在分析...</span>
        </div>
      )}

      {msg.error && (
        <Alert type="error" message={msg.error} showIcon style={{ borderRadius: 8 }} />
      )}
    </div>
  );
};

// ── Chat page ──────────────────────────────────────────────────────────────

const Chat: React.FC = () => {
  const { workspace = '' } = useParams<{ workspace: string }>();
  const navigate = useNavigate();

  const [wsInfo, setWsInfo] = useState<WorkspaceInfo | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);

  const cancelRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef(uid());

  // Load workspace info + examples
  useEffect(() => {
    if (!workspace) return;

    api.get<WorkspaceInfo>(`/workspaces/${workspace}`).then((res) => setWsInfo(res.data));

    api
      .get<FewShotExample[]>(`/workspaces/${workspace}/examples`)
      .then((res) => {
        const qs = res.data
          .map((ex) => ex.question ?? ex.q ?? '')
          .filter(Boolean)
          .slice(0, 6);
        setExamples(qs as string[]);
      })
      .catch(() => {});
  }, [workspace]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateLastMessage = useCallback((updater: (msg: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = updater(updated[updated.length - 1]);
      return updated;
    });
  }, []);

  const sendQuestion = useCallback(
    (question: string) => {
      if (!question.trim() || streaming) return;

      // Cancel any in-flight stream
      cancelRef.current?.();

      // Add user message
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        question: question.trim(),
        steps: [],
        streaming: false,
      };

      // Add empty assistant placeholder
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        steps: [],
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInputValue('');
      setStreaming(true);

      // Pending sql/result waiting to be attached to the next step
      let pendingSql: string | undefined;

      const cancel = fetchSSE(
        '/chat',
        { question: question.trim(), workspace, session_id: sessionId.current },
        (event: SSEEvent) => {
          const type = event.type as string;

          if (type === 'step') {
            const newStep: ReasoningStep = {
              node_id: event.node_id as string ?? '',
              node_label: event.node_label as string ?? '',
              metric_value: event.metric_value,
              threshold: event.threshold,
              status: event.status as string ?? '',
              explanation: event.explanation as string ?? '',
              sql: pendingSql,
            };
            pendingSql = undefined;
            updateLastMessage((msg) => ({
              ...msg,
              steps: [...msg.steps, newStep],
            }));
          } else if (type === 'sql') {
            pendingSql = event.sql as string;
          } else if (type === 'result') {
            // Attach result to the last step that has no result yet
            updateLastMessage((msg) => {
              if (msg.steps.length === 0) return msg;
              const steps = [...msg.steps];
              const last = { ...steps[steps.length - 1] };
              last.result = {
                columns: event.columns as string[],
                rows: event.rows as unknown[][],
                row_count: event.row_count as number,
                error: event.error as string | undefined,
              };
              steps[steps.length - 1] = last;
              return { ...msg, steps };
            });
          } else if (type === 'conclusion') {
            updateLastMessage((msg) => ({
              ...msg,
              conclusion: event.text as string,
              chartHint: event.chart_hint as string,
            }));
          } else if (type === 'error') {
            updateLastMessage((msg) => ({
              ...msg,
              error: event.message as string,
              streaming: false,
            }));
            setStreaming(false);
          }
        },
        () => {
          // done
          updateLastMessage((msg) => ({ ...msg, streaming: false }));
          setStreaming(false);
        },
        (err: Error) => {
          updateLastMessage((msg) => ({
            ...msg,
            error: err.message,
            streaming: false,
          }));
          setStreaming(false);
        },
      );

      cancelRef.current = cancel;
    },
    [streaming, workspace, updateLastMessage],
  );

  const handleSubmit = () => {
    sendQuestion(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Top bar */}
      <Header
        style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: 56,
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
        />
        <DatabaseOutlined style={{ color: '#4f46e5' }} />
        <Text strong style={{ fontSize: 16 }}>
          {wsInfo?.title ?? workspace}
        </Text>
        {wsInfo?.current_period && (
          <Tag color="geekblue">周期 {wsInfo.current_period}</Tag>
        )}
        <div style={{ flex: 1 }} />
        <Button
          type="link"
          onClick={() => navigate(`/w/${workspace}/explore`)}
          style={{ color: '#4f46e5' }}
        >
          数据探索
        </Button>
      </Header>

      <Layout>
        {/* Left panel: example questions */}
        <Sider
          width={240}
          style={{
            background: '#fafafa',
            borderRight: '1px solid #f0f0f0',
            padding: '16px 12px',
            overflow: 'auto',
          }}
          breakpoint="lg"
          collapsedWidth={0}
        >
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
            示例问题
          </Text>
          {examples.length === 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无示例
            </Text>
          )}
          {examples.map((q, i) => (
            <div
              key={i}
              onClick={() => sendQuestion(q)}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                marginBottom: 6,
                cursor: 'pointer',
                background: '#fff',
                border: '1px solid #e8e8e8',
                fontSize: 12,
                color: '#333',
                lineHeight: 1.5,
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#4f46e5')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#e8e8e8')}
            >
              {q}
            </div>
          ))}
        </Sider>

        {/* Right panel: chat area */}
        <Content
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 56px)',
          }}
        >
          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 32px',
            }}
          >
            {messages.length === 0 && (
              <Empty
                description={
                  <span style={{ color: '#999' }}>
                    提出一个问题，AI 将自动沿因果链路归因分析
                  </span>
                }
                style={{ marginTop: 80 }}
              />
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div
            style={{
              borderTop: '1px solid #f0f0f0',
              padding: '16px 32px',
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <TextArea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入问题... (Enter 发送，Shift+Enter 换行)"
                autoSize={{ minRows: 1, maxRows: 5 }}
                style={{ flex: 1, borderRadius: 10, resize: 'none' }}
                disabled={streaming}
              />
              <Button
                type="primary"
                icon={streaming ? <LoadingOutlined /> : <SendOutlined />}
                onClick={handleSubmit}
                disabled={!inputValue.trim() || streaming}
                style={{
                  height: 40,
                  borderRadius: 10,
                  background: '#4f46e5',
                  borderColor: '#4f46e5',
                }}
              >
                {streaming ? '分析中' : '发送'}
              </Button>
            </div>
            <Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
              基于工作空间"{wsInfo?.title ?? workspace}"的因果图谱进行多步推理归因
            </Text>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export default Chat;
