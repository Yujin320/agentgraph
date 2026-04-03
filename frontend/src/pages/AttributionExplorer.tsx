import { useState, useRef, useEffect } from 'react';
import { useSearchParams, useLocation, useParams, useNavigate } from 'react-router-dom';
import {
  Card, Input, Button, Space, Empty, Grid, Tag, Row, Col, Spin,
  Tooltip, Tabs, Avatar, Typography,
} from 'antd';
import {
  SendOutlined, DeleteOutlined, BulbOutlined, BookOutlined,
  CompassOutlined, SearchOutlined, CodeOutlined, RightOutlined, MessageOutlined,
} from '@ant-design/icons';
import api from '../api/client';
import { useTheme } from '../contexts/ThemeContext';

// Lazy imports — these will be created by companion agents
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ChatMessage from '../components/ChatMessage';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import KpiCard from '../components/KpiCard';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { useChat } from '../hooks/useChat';

const { useBreakpoint } = Grid;
const { Text } = Typography;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface Scenario {
  id: string;
  name: string;
  description?: string;
}

interface KpiData {
  label: string;
  value: number | string | null;
  format?: string;
  help?: string;
  error?: string | null;
}

interface SampleQuestion {
  id: string;
  question: string;
  step_label: string;
  step_color: string;
  complexity: number;
  scenario?: string;
}

interface QuickQuestion {
  id: string;
  text: string;
  steps: string;
  stepsColor: string;
  complexity: number;
}

interface FewShotExample {
  id: string;
  scenario: string;
  question: string;
  sql: string;
  answer_hint?: string;
  chart_type?: string | null;
}

interface FewShotsData {
  version?: string;
  description?: string;
  examples: FewShotExample[];
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const FEWSHOT_SCENARIO_COLORS: Record<string, string> = {
  '销量达成分析': 'blue',
  '订单倒挂分析': 'orange',
  '渠道结构分析': 'green',
  '月末挤水分析': 'red',
};

const CHART_LABELS: Record<string, string> = {
  bar: '柱状图',
  line: '折线图',
  pie: '饼图',
  table: '表格',
};

// ──────────────────────────────────────────────
// FewShotsTab (示例库)
// ──────────────────────────────────────────────

function FewShotsTab({
  workspace,
  onAsk,
}: {
  workspace: string;
  onAsk?: (q: string) => void;
}) {
  const [data, setData] = useState<FewShotsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    api
      .get(`/system/few-shots/${workspace}`)
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [workspace]);

  const filtered = (data?.examples ?? []).filter((ex) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      ex.question.toLowerCase().includes(q) ||
      ex.scenario.toLowerCase().includes(q) ||
      ex.sql.toLowerCase().includes(q) ||
      (ex.answer_hint ?? '').toLowerCase().includes(q)
    );
  });

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;
  if (!data) return <Empty description="示例库数据加载失败" />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <BookOutlined style={{ color: 'var(--da-primary)', fontSize: 16 }} />
        <Text strong style={{ fontSize: 15 }}>示例库</Text>
        <Tag style={{ background: '#F1F5F9', color: '#475569', borderColor: '#CBD5E1' }}>
          {data.examples.length} 条示例
        </Tag>
        {data.version && (
          <Tag style={{ background: '#EEF2FF', color: '#4338CA', borderColor: '#C7D2FE' }}>
            v{data.version}
          </Tag>
        )}
        <Input
          prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
          placeholder="搜索问题、场景、SQL…"
          size="small"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 280, marginLeft: 'auto' }}
        />
      </div>

      {filtered.length === 0 && <Empty description="未找到匹配示例" style={{ padding: 60 }} />}

      <div style={{ display: 'grid', gap: 10 }}>
        {filtered.map((ex) => {
          const isExpanded = expandedId === ex.id;
          return (
            <Card
              key={ex.id}
              size="small"
              style={{ borderColor: '#E2E8F0', cursor: 'pointer' }}
              styles={{ body: { padding: '12px 16px' } }}
              onClick={() => setExpandedId(isExpanded ? null : ex.id)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <Avatar
                  size={32}
                  style={{
                    background: '#EEF2FF',
                    color: '#4338CA',
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {ex.id.split('_')[0]}
                </Avatar>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <Tag
                      color={FEWSHOT_SCENARIO_COLORS[ex.scenario] ?? 'default'}
                      style={{ fontSize: 11, margin: 0 }}
                    >
                      {ex.scenario}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>{ex.id}</Text>
                    {ex.chart_type && (
                      <Tag
                        style={{
                          fontSize: 11,
                          margin: 0,
                          background: '#F0FDF4',
                          color: '#16A34A',
                          borderColor: '#BBF7D0',
                        }}
                      >
                        {CHART_LABELS[ex.chart_type] ?? ex.chart_type}
                      </Tag>
                    )}
                    <RightOutlined
                      style={{
                        marginLeft: 'auto',
                        color: '#94A3B8',
                        fontSize: 11,
                        transform: isExpanded ? 'rotate(90deg)' : 'none',
                        transition: 'transform 0.2s',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <MessageOutlined
                      style={{ color: '#6366F1', fontSize: 13, marginTop: 2, flexShrink: 0 }}
                    />
                    <Text strong style={{ fontSize: 13, color: '#1E293B', lineHeight: '20px' }}>
                      {ex.question}
                    </Text>
                  </div>
                  {ex.answer_hint && (
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                      {ex.answer_hint}
                    </Text>
                  )}
                  {onAsk && (
                    <Button
                      size="small"
                      type="link"
                      style={{ padding: '2px 0', fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAsk(ex.question);
                      }}
                    >
                      直接提问 →
                    </Button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <CodeOutlined style={{ color: '#64748B', fontSize: 12 }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>SQL</Text>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '12px 14px',
                      background: '#0F172A',
                      color: '#E2E8F0',
                      borderRadius: 8,
                      fontSize: 12,
                      lineHeight: 1.6,
                      overflowX: 'auto',
                      fontFamily: '"JetBrains Mono","Fira Code","Cascadia Code",monospace',
                      whiteSpace: 'pre',
                      border: '1px solid #1E293B',
                    }}
                  >
                    {ex.sql}
                  </pre>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export default function AttributionExplorer() {
  // workspace comes from route /w/:workspace/*
  const { workspace = '' } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { colors } = useTheme();

  // ── Tab state ───────────────────────────────
  const [activeTab, setActiveTab] = useState('explore');

  // ── Scenarios (from API) ─────────────────────
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  useEffect(() => {
    if (!workspace) return;
    api
      .get(`/scenarios/${workspace}`)
      .then((res) => {
        // API may return array of objects or array of strings
        const raw = res.data;
        if (Array.isArray(raw)) {
          if (raw.length === 0) return;
          if (typeof raw[0] === 'string') {
            setScenarios(raw.map((s: string) => ({ id: s, name: s })));
          } else {
            setScenarios(raw);
          }
        }
      })
      .catch(() => setScenarios([]));
  }, [workspace]);

  // ── Scenario selection ──────────────────────
  const [selectedScenario, setSelectedScenario] = useState<string | null>(
    searchParams.get('scenario') ?? null,
  );

  const handleSelectScenario = (scenarioId: string | null) => {
    setSelectedScenario(scenarioId);
    if (scenarioId) {
      navigate(`/w/${workspace}/attribution?scenario=${encodeURIComponent(scenarioId)}`, { replace: false });
    } else {
      navigate(`/w/${workspace}/attribution`, { replace: false });
    }
  };

  // ── KPI loading ─────────────────────────────
  const [kpis, setKpis] = useState<KpiData[]>([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const kpiScenarioRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedScenario || !workspace) {
      setKpis([]);
      kpiScenarioRef.current = null;
      return;
    }
    if (kpiScenarioRef.current === selectedScenario) return;
    kpiScenarioRef.current = selectedScenario;

    setKpis([]);
    setKpiLoading(true);
    api
      .get(`/scenarios/${workspace}/${encodeURIComponent(selectedScenario)}/kpis`)
      .then((res) => {
        setKpis(Array.isArray(res.data) ? res.data : []);
        setKpiLoading(false);
      })
      .catch(() => setKpiLoading(false));
  }, [selectedScenario, workspace]);

  // ── Sample questions (from API, grouped by scenario) ─────────────
  const [sampleQuestions, setSampleQuestions] = useState<SampleQuestion[]>([]);
  useEffect(() => {
    if (!workspace) return;
    api
      .get(`/system/sample-questions/${workspace}`)
      .then((res) => {
        const raw = res.data;
        // Could be { scenarios, by_scenario } or flat array
        if (raw?.by_scenario) {
          const byScenario: Record<string, SampleQuestion[]> = raw.by_scenario;
          const source = selectedScenario
            ? (byScenario[selectedScenario] ?? [])
            : Object.values(byScenario).flat().slice(0, 8);
          setSampleQuestions(source);
        } else if (Array.isArray(raw)) {
          setSampleQuestions(raw.slice(0, 8));
        }
      })
      .catch(() => setSampleQuestions([]));
  // Re-fetch when scenario changes so chips are filtered
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, selectedScenario]);

  const quickQuestions: QuickQuestion[] = sampleQuestions.map((q) => ({
    id: q.id,
    text: q.question,
    steps: q.step_label,
    stepsColor: q.step_color,
    complexity: q.complexity,
  }));

  // ── Chat (via useChat hook) ─────────────────
  const { messages, loading, sendMessage, clearMessages } = useChat(workspace);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    sendMessage(q);
    setInput('');
    setSearchParams({ q: encodeURIComponent(q) }, { replace: false });
  };

  // Auto-send on mount from ?q= param or location.state.autoQuestion
  useEffect(() => {
    if (autoSentRef.current) return;
    const qParam = searchParams.get('q');
    const autoQuestion = (location.state as { autoQuestion?: string } | null)?.autoQuestion;
    const question = autoQuestion ?? (qParam ? decodeURIComponent(qParam) : null);
    if (!question) return;
    autoSentRef.current = true;
    const timer = setTimeout(() => {
      sendMessage(question);
      setSearchParams({ q: encodeURIComponent(question) }, { replace: true });
    }, 150);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Layout heights ──────────────────────────
  const containerHeight = isMobile ? 'calc(100vh - 68px)' : 'calc(100vh - 76px)';
  const innerHeight = isMobile ? 'calc(100vh - 110px)' : 'calc(100vh - 118px)';

  // ── Explore tab content ─────────────────────
  const exploreContent = (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: innerHeight, gap: 8, paddingTop: 4 }}
    >
      {/* ── 1. Scenario pills ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          padding: '6px 0',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <Tag
          onClick={() => handleSelectScenario(null)}
          style={{
            cursor: 'pointer',
            borderRadius: 16,
            padding: '3px 14px',
            fontSize: 13,
            fontWeight: selectedScenario === null ? 600 : 400,
            background: selectedScenario === null ? colors.primary : colors.bgMuted,
            color: selectedScenario === null ? '#fff' : colors.textSecondary,
            borderColor: selectedScenario === null ? colors.primary : colors.borderBase,
            userSelect: 'none',
            lineHeight: '22px',
          }}
        >
          全部
        </Tag>
        {scenarios.map((s) => {
          const active = selectedScenario === s.id;
          return (
            <Tooltip key={s.id} title={s.description} mouseEnterDelay={0.6}>
              <Tag
                onClick={() => handleSelectScenario(s.id)}
                style={{
                  cursor: 'pointer',
                  borderRadius: 16,
                  padding: '3px 14px',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  background: active ? colors.primary : colors.bgMuted,
                  color: active ? '#fff' : colors.textSecondary,
                  borderColor: active ? colors.primary : colors.borderBase,
                  userSelect: 'none',
                  lineHeight: '22px',
                }}
              >
                {s.name}
              </Tag>
            </Tooltip>
          );
        })}
      </div>

      {/* ── 2. KPI row (only when scenario selected) ── */}
      {selectedScenario && (
        <div style={{ flexShrink: 0 }}>
          {kpiLoading ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <Spin size="small" />
            </div>
          ) : kpis.length > 0 ? (
            <Row gutter={[8, 8]}>
              {kpis.map((kpi, i) => (
                <Col xs={12} sm={12} md={6} key={i}>
                  <KpiCard
                    label={kpi.label}
                    value={kpi.value}
                    format={kpi.format}
                    help={kpi.help}
                    loading={false}
                    error={kpi.error}
                  />
                </Col>
              ))}
            </Row>
          ) : null}
        </div>
      )}

      {/* ── 3. Sample question chips ── */}
      {quickQuestions.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
            flexShrink: 0,
            padding: '2px 0',
          }}
        >
          <BulbOutlined style={{ color: '#faad14', fontSize: 14, flexShrink: 0 }} />
          {quickQuestions.map((q, i) => (
            <Tooltip key={i} title={q.text} placement="top" mouseEnterDelay={0.5}>
              <Button
                size="small"
                disabled={loading}
                onClick={() => {
                  clearMessages();
                  handleSend(q.text);
                }}
                style={{
                  height: 'auto',
                  whiteSpace: 'normal',
                  textAlign: 'left',
                  padding: '4px 12px',
                  borderRadius: 16,
                  borderColor: colors.borderBase,
                  background: colors.bgMuted,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  maxWidth: isMobile ? '100%' : 380,
                  fontSize: 13,
                }}
              >
                <span style={{ flex: 1, lineHeight: '1.4' }}>{q.text}</span>
                <Tag
                  color={q.stepsColor}
                  style={{ fontSize: 11, lineHeight: '18px', flexShrink: 0, margin: 0 }}
                >
                  {q.steps}
                </Tag>
              </Button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* ── 4. Chat area ── */}
      <Card
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        styles={{
          body: { flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' },
        }}
      >
        {/* Messages scroll area */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
          {messages.length === 0 && (
            <Empty
              description="选择分析场景或直接输入问题开始归因探索"
              style={{ marginTop: 60 }}
            />
          )}
          {messages.map((msg: unknown, i: number) => (
            <ChatMessage key={i} msg={msg as import('../components/ChatMessage').ChatMsg} onFollowUp={(q: string) => handleSend(q)} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: `1px solid ${colors.borderSubtle}`,
            background: colors.bgMuted,
            flexShrink: 0,
          }}
        >
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="请输入您的问题，例如：上月销量为何下滑？"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={() => handleSend()}
              disabled={loading}
              size="large"
              style={{ borderRadius: '8px 0 0 8px' }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => handleSend()}
              loading={loading}
              size="large"
              style={{
                borderRadius: '0 8px 8px 0',
                background: colors.primary,
                borderColor: colors.primary,
              }}
            >
              {isMobile ? null : '发送'}
            </Button>
            <Button
              icon={<DeleteOutlined />}
              onClick={clearMessages}
              size="large"
              title="清空对话"
            />
          </Space.Compact>
        </div>
      </Card>
    </div>
  );

  return (
    <Tabs
      activeKey={activeTab}
      onChange={setActiveTab}
      style={{ height: containerHeight }}
      tabBarStyle={{ marginBottom: 0 }}
      items={[
        {
          key: 'explore',
          label: (
            <span>
              <CompassOutlined /> 归因探索
            </span>
          ),
          children: exploreContent,
        },
        {
          key: 'examples',
          label: (
            <span>
              <BookOutlined /> 示例库
            </span>
          ),
          children: (
            <div style={{ overflow: 'auto', height: innerHeight, paddingTop: 8 }}>
              <FewShotsTab
                workspace={workspace}
                onAsk={(q) => {
                  handleSend(q);
                  setActiveTab('explore');
                }}
              />
            </div>
          ),
        },
      ]}
    />
  );
}
