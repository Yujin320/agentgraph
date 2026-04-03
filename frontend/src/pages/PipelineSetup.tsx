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
} from '@ant-design/icons';
import { pipelineApi } from '../api/client';

const { Title, Paragraph, Text } = Typography;

// Stage display names in Chinese (order matches SETUP_STAGES)
const STAGE_LABELS: Record<string, string> = {
  connect: '数据源连接',
  discover: 'Schema 发现',
  enrich: '语义标注',
  knowledge: '知识图谱',
  train: 'SQL 训练',
};

// Stage descriptions
const STAGE_DESCRIPTIONS: Record<string, string> = {
  connect: '验证数据库连接，统计表和行数',
  discover: '自动发现 Schema 结构，推断外键关系和字段角色',
  enrich: 'LLM 标注中文别名和业务描述（需人工审核）',
  knowledge: '构建因果知识图谱，写入 Neo4j',
  train: '自动生成问答对，建立向量索引',
};

// Stage estimated times
const STAGE_EST_TIME: Record<string, string> = {
  connect: '约 5 秒',
  discover: '约 10–30 秒',
  enrich: '约 1–3 分钟（LLM 调用）',
  knowledge: '约 30 秒–2 分钟',
  train: '约 1–5 分钟',
};

// Stage icons
const STAGE_ICONS: Record<string, React.ReactNode> = {
  connect: <DatabaseOutlined />,
  discover: <SearchOutlined />,
  enrich: <FileSearchOutlined />,
  knowledge: <ApartmentOutlined />,
  train: <BranchesOutlined />,
};

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
