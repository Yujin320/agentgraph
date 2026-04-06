import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Steps,
  Button,
  Card,
  Typography,
  Alert,
  Spin,
  Space,
  Tag,
  message,
  Progress,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ForwardOutlined,
  DatabaseOutlined,
  SearchOutlined,
  FileSearchOutlined,
  ApartmentOutlined,
  BranchesOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { pipelineApi } from '../api/client';

const { Title, Paragraph, Text } = Typography;

// Stage display names in Chinese (order matches SETUP_STAGES)
const STAGE_LABELS: Record<string, string> = {
  connect: '数据源连接',
  introspect: 'Schema 发现',
  enrich: '语义标注',
  build_kg: '知识图谱',
  train_sql: 'SQL 训练',
};

// Stage descriptions
const STAGE_DESCRIPTIONS: Record<string, string> = {
  connect: '验证数据库连接，统计表和行数',
  introspect: '自动发现 Schema 结构，推断外键关系和字段角色',
  enrich: 'LLM 标注中文别名和业务描述（需人工审核）',
  build_kg: '构建因果知识图谱，写入 Neo4j',
  train_sql: '自动生成问答对，建立向量索引',
};

// Stage estimated times
const STAGE_EST_TIME: Record<string, string> = {
  connect: '约 5 秒',
  introspect: '约 10–30 秒',
  enrich: '约 1–3 分钟（LLM 调用）',
  build_kg: '约 30 秒–2 分钟',
  train_sql: '约 1–5 分钟',
};

// Stage icons
const STAGE_ICONS: Record<string, React.ReactNode> = {
  connect: <DatabaseOutlined />,
  introspect: <SearchOutlined />,
  enrich: <FileSearchOutlined />,
  build_kg: <ApartmentOutlined />,
  train_sql: <BranchesOutlined />,
};

// Stage sub-steps: internal logic flow shown in expanded card
const STAGE_SUBSTEPS: Record<string, { title: string; desc: string }[]> = {
  connect: [
    { title: '连接验证', desc: 'SQLAlchemy 建立数据库连接' },
    { title: '表扫描', desc: '统计表数量和总行数' },
    { title: '连接信息', desc: '记录数据库类型和版本' },
  ],
  introspect: [
    { title: '表结构扫描', desc: '获取所有表的列名、类型、主键' },
    { title: '列级统计', desc: '计算基数、空值率、极值、Top-5 去重值' },
    { title: '外键推断', desc: '基于列名相似度推断表间关联关系' },
    { title: '角色分类', desc: '自动标注度量（measure）和维度（dimension）' },
  ],
  enrich: [
    { title: 'LLM 语义生成', desc: '为每个表和列生成中文业务名称' },
    { title: '规则标注', desc: '标注数据过滤条件和业务口径' },
    { title: '人工审核', desc: '暂停等待用户审查和修正语义标注' },
    { title: '字典持久化', desc: '确认后写入 schema_dict.yaml' },
  ],
  build_kg: [
    { title: '节点提取', desc: '从语义字典提取 Metric / Dimension / Table 节点' },
    { title: '关系构建', desc: '建立 CAUSES（因果）和 RELATES_TO（关联）边' },
    { title: '场景配置', desc: '定义归因场景入口指标和下钻路径' },
    { title: '写入 Neo4j', desc: '批量导入节点和边到图数据库' },
  ],
  train_sql: [
    { title: '示例生成', desc: '基于 KG 场景自动生成 SQL 问答对' },
    { title: '向量化', desc: '将问题-SQL 对编码写入 ChromaDB' },
    { title: 'RAG 验证', desc: '测试检索召回率确保质量' },
  ],
};

// Stage input / output labels
const STAGE_IO: Record<string, { input: string; output: string }> = {
  connect: { input: '数据库 URL', output: '连接状态 + 表统计' },
  introspect: { input: '数据库连接', output: '原始 Schema JSON（列统计 + 角色标注）' },
  enrich: { input: '原始 Schema', output: 'schema_dict.yaml（语义增强）' },
  build_kg: { input: '语义字典 + 业务规则', output: 'Neo4j 图谱（节点 + 边 + 场景）' },
  train_sql: { input: 'KG + Schema + Few-shots', output: 'ChromaDB 向量索引' },
};

// Ordered stage keys for the flow diagram
const ORDERED_STAGES = ['connect', 'introspect', 'enrich', 'build_kg', 'train_sql'];

type StageStatus = 'pending' | 'running' | 'completed' | 'needs_review' | 'failed' | 'skipped';

interface StageState {
  name: string;
  status: StageStatus;
  error?: string;
  updated_at?: string;
}

interface PipelineState {
  workspace: string;
  status: string;
  stages: StageState[];
}

function stageToStepStatus(
  status: StageStatus,
): 'wait' | 'process' | 'finish' | 'error' {
  switch (status) {
    case 'completed':
    case 'skipped':
      return 'finish';
    case 'running':
      return 'process';
    case 'failed':
      return 'error';
    default:
      return 'wait';
  }
}

function StageStatusTag({ status }: { status: StageStatus }) {
  const map: Record<StageStatus, { color: string; label: string }> = {
    pending: { color: 'default', label: '等待中' },
    running: { color: 'processing', label: '运行中' },
    completed: { color: 'success', label: '已完成' },
    needs_review: { color: 'warning', label: '待审核' },
    failed: { color: 'error', label: '失败' },
    skipped: { color: 'default', label: '已跳过' },
  };
  const { color, label } = map[status] ?? { color: 'default', label: status };
  return <Tag color={color}>{label}</Tag>;
}

// ─── Horizontal pipeline flow diagram ────────────────────────────────────────
function PipelineFlowDiagram({ stages }: { stages: StageState[] }) {
  const statusMap: Record<string, StageStatus> = {};
  stages.forEach((s) => { statusMap[s.name] = s.status; });

  const nodeColor = (stageName: string) => {
    const st = statusMap[stageName] ?? 'pending';
    switch (st) {
      case 'completed':
      case 'skipped': return { bg: '#f0fff4', border: '#52c41a', text: '#389e0d' };
      case 'running': return { bg: '#eef2ff', border: '#4338ca', text: '#4338ca' };
      case 'failed': return { bg: '#fff1f0', border: '#ff4d4f', text: '#cf1322' };
      case 'needs_review': return { bg: '#fffbe6', border: '#faad14', text: '#d48806' };
      default: return { bg: '#fafafa', border: '#d9d9d9', text: '#8c8c8c' };
    }
  };

  const nodeIcon = (stageName: string) => {
    const st = statusMap[stageName] ?? 'pending';
    if (st === 'running') return <LoadingOutlined style={{ fontSize: 14 }} />;
    if (st === 'completed' || st === 'skipped') return <CheckCircleOutlined style={{ fontSize: 14 }} />;
    if (st === 'failed') return <CloseCircleOutlined style={{ fontSize: 14 }} />;
    return STAGE_ICONS[stageName] ?? <ClockCircleOutlined style={{ fontSize: 14 }} />;
  };

  return (
    <Card style={{ borderRadius: 12, marginBottom: 24 }} styles={{ body: { padding: '20px 24px' } }}>
      <Text strong style={{ fontSize: 13, color: '#555', display: 'block', marginBottom: 16 }}>
        流程总览
      </Text>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'nowrap',
        gap: 4,
        overflowX: 'auto',
        paddingBottom: 4,
      }}>
        {ORDERED_STAGES.map((stageName, idx) => {
          const colors = nodeColor(stageName);
          return (
            <React.Fragment key={stageName}>
              {/* Stage node */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: 90,
                flex: '0 0 auto',
              }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: colors.bg,
                  border: `2px solid ${colors.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: colors.text,
                  fontSize: 18,
                  marginBottom: 8,
                  boxShadow: statusMap[stageName] === 'running'
                    ? `0 0 0 4px ${colors.border}22`
                    : 'none',
                  transition: 'box-shadow 0.3s',
                }}>
                  {nodeIcon(stageName)}
                </div>
                <Text style={{
                  fontSize: 11,
                  color: colors.text,
                  textAlign: 'center',
                  fontWeight: statusMap[stageName] === 'running' ? 600 : 400,
                  lineHeight: 1.3,
                  maxWidth: 80,
                }}>
                  {STAGE_LABELS[stageName] ?? stageName}
                </Text>
              </div>
              {/* Arrow between nodes */}
              {idx < ORDERED_STAGES.length - 1 && (
                <div style={{
                  flex: '1 1 0',
                  minWidth: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingBottom: 24,
                }}>
                  <div style={{
                    height: 2,
                    flex: 1,
                    background: (() => {
                      const thisStatus = statusMap[stageName] ?? 'pending';
                      if (thisStatus === 'completed' || thisStatus === 'skipped') return '#52c41a';
                      return '#e0e0e0';
                    })(),
                    transition: 'background 0.3s',
                  }} />
                  <ArrowRightOutlined style={{
                    fontSize: 10,
                    color: (() => {
                      const thisStatus = statusMap[stageName] ?? 'pending';
                      if (thisStatus === 'completed' || thisStatus === 'skipped') return '#52c41a';
                      return '#bfbfbf';
                    })(),
                    flexShrink: 0,
                  }} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Sub-steps mini timeline ──────────────────────────────────────────────────
function StageSubSteps({ stageName, status }: { stageName: string; status: StageStatus }) {
  const substeps = STAGE_SUBSTEPS[stageName];
  if (!substeps || substeps.length === 0) return null;

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
      <Steps
        direction="vertical"
        size="small"
        style={{ marginLeft: 4 }}
        current={status === 'completed' || status === 'skipped' ? substeps.length : status === 'running' ? -1 : -1}
        status={status === 'failed' ? 'error' : status === 'running' ? 'process' : 'finish'}
        items={substeps.map((step) => ({
          title: (
            <Text style={{ fontSize: 12, fontWeight: 500 }}>{step.title}</Text>
          ),
          description: (
            <Text type="secondary" style={{ fontSize: 11 }}>{step.desc}</Text>
          ),
        }))}
      />
    </div>
  );
}

// ─── Input / Output labels ────────────────────────────────────────────────────
function StageIOLabel({ stageName }: { stageName: string }) {
  const io = STAGE_IO[stageName];
  if (!io) return null;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
      flexWrap: 'wrap',
    }}>
      <Tag style={{ fontSize: 11, margin: 0, background: '#f5f5f5', borderColor: '#d9d9d9', color: '#595959' }}>
        <Text style={{ fontSize: 11, color: '#8c8c8c' }}>输入：</Text>
        {io.input}
      </Tag>
      <ArrowRightOutlined style={{ fontSize: 10, color: '#bfbfbf' }} />
      <Tag style={{ fontSize: 11, margin: 0, background: '#f0f5ff', borderColor: '#adc6ff', color: '#2f54eb' }}>
        <Text style={{ fontSize: 11, color: '#8c8c8c' }}>输出：</Text>
        {io.output}
      </Tag>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const PipelineSetup: React.FC = () => {
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningNext, setRunningNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ws = workspace ?? '';

  const fetchState = useCallback(async () => {
    try {
      const res = await pipelineApi.getState(ws);
      setState(res.data as PipelineState);
      setError(null);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err as Error)?.message ??
        '加载失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [ws]);

  // Poll while any stage is running
  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    const isRunning = state?.stages.some((s) => s.status === 'running');
    if (isRunning) {
      pollRef.current = setInterval(fetchState, 2000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state, fetchState]);

  const handleRunNext = async () => {
    setRunningNext(true);
    try {
      await pipelineApi.runNext(ws);
      await fetchState();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err as Error)?.message ??
        '执行失败';
      message.error(`执行失败：${msg}`);
    } finally {
      setRunningNext(false);
    }
  };

  const handleRetry = async (stage: string) => {
    try {
      await pipelineApi.runStage(ws, stage);
      await fetchState();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err as Error)?.message ??
        '重试失败';
      message.error(`重试失败：${msg}`);
    }
  };

  const handleSkip = async (stage: string) => {
    try {
      await pipelineApi.skipStage(ws, stage);
      await fetchState();
      message.success(`已跳过阶段：${STAGE_LABELS[stage] ?? stage}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err as Error)?.message ??
        '跳过失败';
      message.error(`跳过失败：${msg}`);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error && !state) {
    return (
      <div style={{ padding: 48 }}>
        <Alert type="error" message="加载失败" description={error} showIcon />
      </div>
    );
  }

  const stages = state?.stages ?? [];
  const currentStep = stages.findIndex((s) => s.status === 'running' || s.status === 'pending');
  const hasPending = stages.some((s) => s.status === 'pending');
  const isRunning = stages.some((s) => s.status === 'running');
  const allDone = stages.length > 0 && stages.every((s) => ['completed', 'skipped'].includes(s.status));
  const hasNeedsReview = stages.some((s) => s.status === 'needs_review');

  // Overall progress percentage
  const completedCount = stages.filter((s) => ['completed', 'skipped'].includes(s.status)).length;
  const overallPct = stages.length > 0 ? Math.round((completedCount / stages.length) * 100) : 0;

  // Stage border color helper
  const stageBorderColor = (status: StageStatus) => {
    switch (status) {
      case 'completed':
      case 'skipped': return '#52c41a';
      case 'failed': return '#ff4d4f';
      case 'running': return 'var(--da-primary, #4338ca)';
      case 'needs_review': return '#faad14';
      default: return '#d9d9d9';
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '48px 24px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <Title level={2} style={{ margin: 0 }}>
            知识库构建流程
          </Title>
          <Paragraph style={{ color: '#888', marginTop: 4, marginBottom: 0 }}>
            工作空间：<Text strong>{ws}</Text>
          </Paragraph>
        </div>

        {allDone && (
          <Alert
            type="success"
            message="所有阶段已完成！"
            description="知识库已就绪，您可以开始使用 ChatBI 进行分析。"
            showIcon
            style={{ marginBottom: 24 }}
            action={
              <Button type="primary" onClick={() => navigate(`/w/${ws}`)} style={{ background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)' }}>
                开始分析
              </Button>
            }
          />
        )}

        {/* Overall progress */}
        {stages.length > 0 && (
          <Card style={{ borderRadius: 12, marginBottom: 24 }} styles={{ body: { padding: '16px 24px' } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 14 }}>
                整体进度
              </Text>
              <Text style={{ fontSize: 13, color: overallPct === 100 ? '#52c41a' : 'var(--da-primary, #4338ca)' }}>
                {completedCount} / {stages.length} 阶段完成
              </Text>
            </div>
            <Progress
              percent={overallPct}
              strokeColor={overallPct === 100 ? '#52c41a' : 'var(--da-primary, #4338ca)'}
              size={['100%', 8]}
              showInfo={false}
            />
          </Card>
        )}

        {/* Horizontal pipeline flow diagram */}
        {stages.length > 0 && <PipelineFlowDiagram stages={stages} />}

        {/* Steps overview */}
        <Card style={{ borderRadius: 12, marginBottom: 24 }}>
          <Steps
            current={currentStep >= 0 ? currentStep : stages.length}
            style={{ padding: '8px 0' }}
            items={stages.map((s) => ({
              title: STAGE_LABELS[s.name] ?? s.name,
              status: stageToStepStatus(s.status),
              icon:
                s.status === 'running' ? (
                  <LoadingOutlined />
                ) : s.status === 'completed' || s.status === 'skipped' ? (
                  <CheckCircleOutlined />
                ) : s.status === 'failed' ? (
                  <CloseCircleOutlined />
                ) : (
                  <ClockCircleOutlined />
                ),
            }))}
          />
        </Card>

        {/* Stage detail cards */}
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {stages.map((stage) => (
            <Card
              key={stage.name}
              style={{
                borderRadius: 10,
                borderLeft: `4px solid ${stageBorderColor(stage.status)}`,
              }}
              styles={{ body: { padding: '16px 20px' } }}
            >
              {/* Title row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Space align="start">
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: stage.status === 'completed' || stage.status === 'skipped' ? '#f0fff4'
                      : stage.status === 'running' ? '#eef2ff'
                      : stage.status === 'failed' ? '#fff1f0'
                      : '#fafafa',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: stageBorderColor(stage.status), fontSize: 16, flexShrink: 0,
                  }}>
                    {STAGE_ICONS[stage.name] ?? <ClockCircleOutlined />}
                  </div>
                  <div>
                    <Space align="center">
                      <Text strong style={{ fontSize: 15 }}>
                        {STAGE_LABELS[stage.name] ?? stage.name}
                      </Text>
                      <StageStatusTag status={stage.status} />
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                      {STAGE_DESCRIPTIONS[stage.name] ?? ''}
                    </Text>
                  </div>
                </Space>

                <Space>
                  {/* Est. time for pending stages */}
                  {(stage.status === 'pending') && STAGE_EST_TIME[stage.name] && (
                    <Tooltip title="预计耗时（取决于数据量和网络）">
                      <Tag color="default" style={{ fontSize: 11 }}>
                        <ClockCircleOutlined style={{ marginRight: 3 }} />
                        {STAGE_EST_TIME[stage.name]}
                      </Tag>
                    </Tooltip>
                  )}
                  {stage.status === 'running' && (
                    <Tag color="processing" style={{ fontSize: 11 }}>
                      <LoadingOutlined style={{ marginRight: 3 }} />
                      运行中...
                    </Tag>
                  )}
                  {stage.status === 'failed' && (
                    <Button size="small" danger onClick={() => handleRetry(stage.name)}>
                      重试
                    </Button>
                  )}
                  {stage.status === 'needs_review' && stage.name === 'enrich' && (
                    <Button
                      size="small"
                      type="primary"
                      icon={<EyeOutlined />}
                      onClick={() => navigate(`/w/${ws}/setup/schema`)}
                      style={{ background: '#faad14', borderColor: '#faad14' }}
                    >
                      审核 Schema
                    </Button>
                  )}
                  {(stage.status === 'pending' || stage.status === 'failed') && (
                    <Button
                      size="small"
                      icon={<ForwardOutlined style={{ fontSize: 12 }} />}
                      onClick={() => handleSkip(stage.name)}
                    >
                      跳过
                    </Button>
                  )}
                </Space>
              </div>

              {/* Input / Output labels */}
              <StageIOLabel stageName={stage.name} />

              {/* Error display */}
              {stage.status === 'failed' && stage.error && (
                <Alert
                  type="error"
                  message={stage.error}
                  style={{ marginTop: 10, fontSize: 13 }}
                />
              )}

              {/* Completion info */}
              {(stage.status === 'completed' || stage.status === 'skipped') && stage.updated_at && (
                <div style={{ marginTop: 8, display: 'flex', gap: 16, alignItems: 'center' }}>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>
                    完成时间：{new Date(stage.updated_at).toLocaleString('zh-CN')}
                  </Text>
                  {stage.status === 'skipped' && (
                    <Tag color="default" style={{ fontSize: 11 }}>已跳过</Tag>
                  )}
                </div>
              )}

              {/* Running indicator */}
              {stage.status === 'running' && (
                <div style={{ marginTop: 10 }}>
                  <Progress
                    percent={100}
                    status="active"
                    showInfo={false}
                    strokeColor="var(--da-primary, #4338ca)"
                    size={['100%', 4]}
                  />
                </div>
              )}

              {/* Sub-steps: shown for running, needs_review, failed, and completed stages */}
              {(stage.status === 'running' || stage.status === 'needs_review' || stage.status === 'failed' || stage.status === 'completed' || stage.status === 'skipped') && (
                <StageSubSteps stageName={stage.name} status={stage.status} />
              )}
            </Card>
          ))}
        </Space>

        {/* Actions */}
        {!allDone && !hasNeedsReview && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <Button
              type="primary"
              size="large"
              loading={runningNext || isRunning}
              disabled={!hasPending || isRunning}
              onClick={handleRunNext}
              style={{ background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)', minWidth: 180, height: 44 }}
            >
              {isRunning ? '执行中…' : '执行下一步'}
            </Button>
            {hasPending && !isRunning && (
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                下一步：{STAGE_LABELS[stages.find(s => s.status === 'pending')?.name ?? ''] ?? ''} — {STAGE_EST_TIME[stages.find(s => s.status === 'pending')?.name ?? ''] ?? ''}
              </Text>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineSetup;
