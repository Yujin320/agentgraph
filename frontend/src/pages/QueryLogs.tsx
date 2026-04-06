import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Table, Tag, Typography, Rate, Statistic, Row, Col, Button,
  Modal, Descriptions, Space, Tabs, Badge, List, Timeline, Tooltip,
  Alert,
} from 'antd';
import {
  ReloadOutlined, EyeOutlined, CheckCircleOutlined,
  ClockCircleOutlined, StarFilled,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import api from '../api/client';

const { Text, Title, Paragraph } = Typography;

// ─── Types ────────────────────────────────────────────────────────────────────

const modeLabels: Record<string, { text: string; color: string }> = {
  single: { text: '单步', color: 'blue' },
  multi_step: { text: '多步', color: 'purple' },
  causal: { text: '归因', color: 'orange' },
  text_to_sql: { text: '问数', color: 'geekblue' },
  attribution: { text: '归因', color: 'orange' },
};

interface LogEntry {
  id: string;
  session_id?: string;
  question: string;
  expanded_question?: string;
  mode?: string;
  scenario?: string;
  steps_count?: number;
  sql_list?: string[];
  result_summary?: { rows?: number; columns?: string[] };
  interpretation?: string;
  suggestions?: string[];
  status: string;
  error_message?: string;
  duration_ms?: number;
  rating?: number;
  feedback?: string;
  feedback_at?: string;
  created_at: string;
}

interface Stats {
  total: number;
  success: number;
  error: number;
  rated: number;
  avg_rating: number | null;
  avg_duration_ms: number | null;
  by_mode?: Record<string, number>;
}

// ─── Tab 1: 问答记录 ──────────────────────────────────────────────────────────

function LogsTab({ ws }: { ws: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<LogEntry | null>(null);

  const fetchLogs = (p = 1) => {
    setLoading(true);
    setError(null);
    api
      .get(`/logs/${ws}`, { params: { limit: 20, offset: (p - 1) * 20 } })
      .then(res => {
        setLogs(res.data.items ?? res.data.logs ?? res.data ?? []);
        setTotal(res.data.total ?? (res.data.items ?? res.data.logs ?? res.data ?? []).length ?? 0);
        setLoading(false);
      })
      .catch(err => {
        setError(err?.response?.data?.detail ?? '加载日志失败');
        setLoading(false);
      });
  };

  useEffect(() => { fetchLogs(); }, [ws]);

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 100,
      render: (v: string) => <Text code style={{ fontSize: 11 }}>{v?.slice(0, 8) ?? '—'}</Text>,
    },
    {
      title: '问题',
      dataIndex: 'question',
      key: 'question',
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      width: 80,
      render: (v: string) => {
        const m = modeLabels[v] ?? { text: v || '-', color: 'default' };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 70,
      render: (v: string) => (
        <Tag color={v === 'success' ? 'green' : 'red'}>
          {v === 'success' ? '成功' : '失败'}
        </Tag>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'duration_ms',
      key: 'duration',
      width: 80,
      render: (v: number) => v ? `${(v / 1000).toFixed(1)}s` : '—',
    },
    {
      title: '评分',
      dataIndex: 'rating',
      key: 'rating',
      width: 130,
      render: (v: number) =>
        v
          ? <Rate disabled value={v} style={{ fontSize: 12 }} />
          : <Text type="secondary" style={{ fontSize: 11 }}>未评</Text>,
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: '',
      key: 'action',
      width: 40,
      render: (_: unknown, record: LogEntry) => (
        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetail(record)} />
      ),
    },
  ];

  return (
    <>
      <Card
        title="问答记录"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => fetchLogs(page)} size="small">
            刷新
          </Button>
        }
      >
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
        <Table
          dataSource={logs.map(l => ({ ...l, key: l.id }))}
          columns={columns}
          loading={loading}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            showTotal: t => `共 ${t} 条`,
            onChange: p => { setPage(p); fetchLogs(p); },
          }}
          size="small"
          scroll={{ x: 900 }}
          locale={{ emptyText: '暂无查询记录' }}
        />
      </Card>

      <Modal
        title={`查询详情 — ${detail?.id?.slice(0, 12) ?? ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={720}
      >
        {detail && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="问题" span={2}>{detail.question}</Descriptions.Item>
            {detail.expanded_question && (
              <Descriptions.Item label="扩写" span={2}>{detail.expanded_question}</Descriptions.Item>
            )}
            <Descriptions.Item label="模式">
              {modeLabels[detail.mode ?? '']?.text || detail.mode || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="场景">{detail.scenario || '—'}</Descriptions.Item>
            <Descriptions.Item label="步骤数">{detail.steps_count ?? 1}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={detail.status === 'success' ? 'green' : 'red'}>{detail.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="耗时">
              {detail.duration_ms ? `${(detail.duration_ms / 1000).toFixed(1)}s` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="时间">{detail.created_at}</Descriptions.Item>
            {detail.sql_list && detail.sql_list.length > 0 && (
              <Descriptions.Item label="SQL" span={2}>
                <pre style={{ fontSize: 11, maxHeight: 180, overflow: 'auto', margin: 0, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                  {detail.sql_list.join('\n\n--- next step ---\n\n')}
                </pre>
              </Descriptions.Item>
            )}
            {detail.result_summary && (
              <Descriptions.Item label="结果" span={2}>
                {detail.result_summary.rows ?? '—'} 行，{detail.result_summary.columns?.length ?? '—'} 列
              </Descriptions.Item>
            )}
            {detail.interpretation && (
              <Descriptions.Item label="AI解读" span={2}>
                <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, lineHeight: 1.6 }}>
                  {detail.interpretation}
                </div>
              </Descriptions.Item>
            )}
            {detail.error_message && (
              <Descriptions.Item label="错误" span={2}>
                <Text type="danger">{detail.error_message}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="评分">
              {detail.rating ? <Rate disabled value={detail.rating} style={{ fontSize: 14 }} /> : '未评'}
            </Descriptions.Item>
            <Descriptions.Item label="反馈">{detail.feedback || '—'}</Descriptions.Item>
            {detail.suggestions && detail.suggestions.length > 0 && (
              <Descriptions.Item label="建议追问" span={2}>
                <Space wrap>{detail.suggestions.map((s, i) => <Tag key={i}>{s}</Tag>)}</Space>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </>
  );
}

// ─── Tab 2: 反馈分析 ──────────────────────────────────────────────────────────

function FeedbackTab({ ws }: { ws: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [lowRated, setLowRated] = useState<LogEntry[]>([]);
  const [ratingDist, setRatingDist] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);

    api.get(`/logs/${ws}/stats`)
      .then(res => setStats(res.data))
      .catch(() => {});

    api.get(`/logs/${ws}`, { params: { limit: 50, max_rating: 2 } })
      .then(res => setLowRated(res.data.logs ?? []))
      .catch(() => {});

    api.get(`/logs/${ws}`, { params: { limit: 200, min_rating: 1 } })
      .then(res => {
        const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        const entries: LogEntry[] = res.data.items ?? res.data.logs ?? res.data ?? [];
        entries.forEach(l => {
          if (l.rating && l.rating >= 1 && l.rating <= 5) dist[l.rating] = (dist[l.rating] || 0) + 1;
        });
        setRatingDist(dist);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [ws]);

  const successRate = stats && stats.total > 0
    ? ((stats.success / stats.total) * 100).toFixed(1)
    : null;

  const chartOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 16, right: 16, top: 16, bottom: 16, containLabel: true },
    xAxis: {
      type: 'category',
      data: ['1星', '2星', '3星', '4星', '5星'],
      axisLabel: { fontSize: 12 },
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar',
      data: [
        { value: ratingDist[1], itemStyle: { color: '#ff4d4f' } },
        { value: ratingDist[2], itemStyle: { color: '#ff7a45' } },
        { value: ratingDist[3], itemStyle: { color: '#faad14' } },
        { value: ratingDist[4], itemStyle: { color: '#73d13d' } },
        { value: ratingDist[5], itemStyle: { color: '#52c41a' } },
      ],
      barMaxWidth: 48,
      label: { show: true, position: 'top', fontSize: 12, formatter: '{c}' },
    }],
  };

  return (
    <div>
      {/* Stats cards */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="总查询数" value={stats?.total ?? '—'} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="平均评分"
              value={stats?.avg_rating ?? '—'}
              precision={stats?.avg_rating != null ? 1 : undefined}
              suffix={stats?.avg_rating != null ? '/ 5' : ''}
              valueStyle={{ color: '#faad14' }}
              prefix={<StarFilled />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="成功率"
              value={successRate ?? '—'}
              suffix={successRate ? '%' : ''}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="已评价" value={stats?.rated ?? '—'} />
          </Card>
        </Col>
      </Row>

      {/* Rating distribution chart */}
      <Card
        title="评分分布"
        size="small"
        loading={loading}
        style={{ marginBottom: 20 }}
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button>}
      >
        <ReactECharts option={chartOption} style={{ height: 240 }} />
      </Card>

      {/* Low-rated queries */}
      <Card
        title={
          <Space>
            <span>低分查询待改进</span>
            <Tag color="red">评分 ≤ 2</Tag>
          </Space>
        }
        size="small"
        loading={loading}
      >
        {lowRated.length === 0 ? (
          <Text type="secondary">暂无低分查询，继续保持！</Text>
        ) : (
          <List
            dataSource={lowRated}
            size="small"
            renderItem={item => (
              <List.Item
                extra={<Rate disabled value={item.rating} style={{ fontSize: 12 }} />}
              >
                <List.Item.Meta
                  title={<Text style={{ fontSize: 13 }}>{item.question}</Text>}
                  description={
                    <Space size={4} wrap>
                      <Text type="secondary" style={{ fontSize: 11 }}>{item.created_at}</Text>
                      {item.feedback && (
                        <Tooltip title={item.feedback}>
                          <Tag color="volcano" style={{ fontSize: 11, cursor: 'pointer' }}>
                            反馈: {item.feedback.slice(0, 24)}{item.feedback.length > 24 ? '…' : ''}
                          </Tag>
                        </Tooltip>
                      )}
                      {item.error_message && (
                        <Tag color="red" style={{ fontSize: 11 }}>执行报错</Tag>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}

// ─── Tab 3: 知识沉淀 ──────────────────────────────────────────────────────────

function KnowledgeTab({ ws }: { ws: string }) {
  const [candidates, setCandidates] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adopted, setAdopted] = useState<Set<string>>(new Set());

  const load = () => {
    setLoading(true);
    api
      .get(`/logs/${ws}`, { params: { limit: 100, min_rating: 4 } })
      .then(res => {
        setCandidates(res.data.items ?? res.data.logs ?? res.data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [ws]);

  const toggleAdopt = (id: string) => {
    setAdopted(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          高质量问答（评分 ≥ 4）可作为 Few-shot 示例沉淀到知识库，提升未来查询精度。
          共 <Text strong>{candidates.length}</Text> 条候选。
        </Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中…</div>
      ) : candidates.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            暂无高分（≥ 4）记录，多多提问并评价吧！
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
          {candidates.map(item => {
            const isAdopted = adopted.has(item.id);
            return (
              <Card
                key={item.id}
                size="small"
                style={{
                  borderColor: isAdopted ? '#52c41a' : undefined,
                  transition: 'border-color 0.3s',
                }}
                title={
                  <Space size={6}>
                    <Badge
                      count="候选 Few-shot"
                      style={{ backgroundColor: 'var(--da-primary, #4338ca)', fontSize: 11, lineHeight: '16px', padding: '0 6px', height: 16, borderRadius: 3 }}
                    />
                    {isAdopted
                      ? <Tag color="success" icon={<CheckCircleOutlined />}>已采纳</Tag>
                      : <Tag color="warning">待审核</Tag>
                    }
                  </Space>
                }
                extra={
                  <Button
                    size="small"
                    type={isAdopted ? 'default' : 'primary'}
                    onClick={() => toggleAdopt(item.id)}
                    style={isAdopted
                      ? { color: '#52c41a', borderColor: '#52c41a' }
                      : { background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)' }
                    }
                  >
                    {isAdopted ? '取消采纳' : '加入示例库'}
                  </Button>
                }
              >
                <div style={{ marginBottom: 10 }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>问题</Text>
                  <Text strong style={{ fontSize: 13 }}>{item.question}</Text>
                </div>

                {item.sql_list && item.sql_list.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>SQL</Text>
                    <pre style={{
                      fontSize: 11, maxHeight: 110, overflow: 'auto', margin: 0,
                      background: '#f5f5f5', padding: 8, borderRadius: 4,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {item.sql_list[0]}
                    </pre>
                  </div>
                )}

                {item.result_summary && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      结果：{item.result_summary.rows ?? '—'} 行，{item.result_summary.columns?.length ?? '—'} 列
                    </Text>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <Rate disabled value={item.rating} style={{ fontSize: 13 }} />
                  <Text type="secondary" style={{ fontSize: 11 }}>{item.created_at}</Text>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab 4: 演化路线 ──────────────────────────────────────────────────────────

function RoadmapTab() {
  const done = <CheckCircleOutlined style={{ fontSize: 18, color: '#52c41a' }} />;
  const pending = <ClockCircleOutlined style={{ fontSize: 18, color: '#fa8c16' }} />;

  const items = [
    {
      dot: done,
      children: (
        <Card size="small" style={{ borderLeft: '3px solid #52c41a', marginBottom: 4 }}>
          <Space style={{ marginBottom: 6 }}>
            <Title level={5} style={{ margin: 0 }}>查询日志采集</Title>
            <Badge count="已上线" style={{ backgroundColor: '#52c41a', fontSize: 11 }} />
          </Space>
          <Paragraph style={{ margin: 0, fontSize: 13, color: '#555' }}>
            每条问答完整记录：用户问题、生成 SQL、执行结果、耗时、用户评分与反馈，
            所有日志持久化于数据库，可随时回溯与分析，为自动化学习提供原始数据基础。
          </Paragraph>
        </Card>
      ),
    },
    {
      dot: done,
      children: (
        <Card size="small" style={{ borderLeft: '3px solid #52c41a', marginBottom: 4 }}>
          <Space style={{ marginBottom: 6 }}>
            <Title level={5} style={{ margin: 0 }}>用户反馈系统</Title>
            <Badge count="已上线" style={{ backgroundColor: '#52c41a', fontSize: 11 }} />
          </Space>
          <Paragraph style={{ margin: 0, fontSize: 13, color: '#555' }}>
            用户可对每次查询结果进行 1–5 星评分并留下文字反馈，系统提供反馈分析看板，
            自动识别低质量回答，为知识库改进提供数据驱动的优化依据。
          </Paragraph>
        </Card>
      ),
    },
    {
      dot: pending,
      children: (
        <Card size="small" style={{ borderLeft: '3px solid #fa8c16', marginBottom: 4 }}>
          <Space style={{ marginBottom: 6 }}>
            <Title level={5} style={{ margin: 0 }}>Few-shot 自动扩展</Title>
            <Badge count="规划中" style={{ backgroundColor: '#fa8c16', fontSize: 11 }} />
          </Space>
          <Paragraph style={{ margin: 0, fontSize: 13, color: '#555' }}>
            对评分 ≥ 4 的高质量问答，人工审核确认后自动追加至
            <Text code>knowledge/few_shots.json</Text>。
            Few-shot 示例越丰富，SQL 生成的准确率越高，系统将通过真实反馈持续自我进化。
          </Paragraph>
        </Card>
      ),
    },
    {
      dot: pending,
      children: (
        <Card size="small" style={{ borderLeft: '3px solid #fa8c16', marginBottom: 4 }}>
          <Space style={{ marginBottom: 6 }}>
            <Title level={5} style={{ margin: 0 }}>因果图谱自动更新</Title>
            <Badge count="规划中" style={{ backgroundColor: '#fa8c16', fontSize: 11 }} />
          </Space>
          <Paragraph style={{ margin: 0, fontSize: 13, color: '#555' }}>
            分析高频问答中的指标组合与场景关联，自动检测潜在的新因果边并候选写入 Neo4j。
            归因图谱将随业务问题的演变保持同步更新，持续扩展覆盖范围。
          </Paragraph>
        </Card>
      ),
    },
    {
      dot: pending,
      children: (
        <Card size="small" style={{ borderLeft: '3px solid #fa8c16', marginBottom: 4 }}>
          <Space style={{ marginBottom: 6 }}>
            <Title level={5} style={{ margin: 0 }}>阈值自校准</Title>
            <Badge count="规划中" style={{ backgroundColor: '#fa8c16', fontSize: 11 }} />
          </Space>
          <Paragraph style={{ margin: 0, fontSize: 13, color: '#555' }}>
            基于历史成功率与用户评分，动态调整查询超时、多步分解阈值、归因置信度等关键参数，
            从运行数据中学习最优配置，减少人工调参，提升整体响应效率与准确性。
          </Paragraph>
        </Card>
      ),
    },
    {
      dot: pending,
      children: (
        <Card size="small" style={{ borderLeft: '3px solid #fa8c16', marginBottom: 4 }}>
          <Space style={{ marginBottom: 6 }}>
            <Title level={5} style={{ margin: 0 }}>多数据源联邦查询</Title>
            <Badge count="规划中" style={{ backgroundColor: '#fa8c16', fontSize: 11 }} />
          </Space>
          <Paragraph style={{ margin: 0, fontSize: 13, color: '#555' }}>
            支持跨工作空间、跨数据库的联合查询，通过语义统一层自动处理不同数据源的 Schema 差异，
            实现真正的企业级多数据源智能分析能力。
          </Paragraph>
        </Card>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', paddingTop: 8 }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>自学习演化路线</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          DataAgent 的目标是通过持续的用户反馈闭环，实现知识库与推理能力的自动化扩充与校准。
        </Text>
      </div>
      <Timeline items={items} />
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function QueryLogs() {
  const { workspace } = useParams<{ workspace: string }>();
  const ws = workspace ?? '';

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>学习进化</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          问答记录 · 反馈分析 · 知识沉淀 · 演化路线
        </Text>
      </div>

      <Tabs
        defaultActiveKey="logs"
        items={[
          { key: 'logs', label: '问答记录', children: <LogsTab ws={ws} /> },
          { key: 'feedback', label: '反馈分析', children: <FeedbackTab ws={ws} /> },
          { key: 'knowledge', label: '知识沉淀', children: <KnowledgeTab ws={ws} /> },
          { key: 'roadmap', label: '演化路线', children: <RoadmapTab /> },
        ]}
      />
    </div>
  );
}
