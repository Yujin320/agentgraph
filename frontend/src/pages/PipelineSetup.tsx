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
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ForwardOutlined,
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

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '48px 24px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <Title level={2} style={{ margin: 0 }}>
            知识库构建流程
          </Title>
          <Paragraph style={{ color: '#888', marginTop: 4 }}>
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
              <Button type="primary" onClick={() => navigate(`/w/${ws}`)} style={{ background: '#4f46e5', borderColor: '#4f46e5' }}>
                开始分析
              </Button>
            }
          />
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
                borderLeft: `4px solid ${
                  stage.status === 'completed' || stage.status === 'skipped'
                    ? '#52c41a'
                    : stage.status === 'failed'
                    ? '#ff4d4f'
                    : stage.status === 'running'
                    ? '#1677ff'
                    : stage.status === 'needs_review'
                    ? '#faad14'
                    : '#d9d9d9'
                }`,
              }}
              styles={{ body: { padding: '16px 20px' } }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <Text strong style={{ fontSize: 15 }}>
                    {STAGE_LABELS[stage.name] ?? stage.name}
                  </Text>
                  <StageStatusTag status={stage.status} />
                </Space>

                <Space>
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

              {stage.status === 'failed' && stage.error && (
                <Alert
                  type="error"
                  message={stage.error}
                  style={{ marginTop: 10, fontSize: 13 }}
                />
              )}

              {(stage.status === 'completed' || stage.status === 'skipped') && stage.updated_at && (
                <Text style={{ color: '#aaa', fontSize: 12, marginTop: 6, display: 'block' }}>
                  完成时间：{new Date(stage.updated_at).toLocaleString('zh-CN')}
                </Text>
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
              style={{ background: '#4f46e5', borderColor: '#4f46e5', minWidth: 160 }}
            >
              {isRunning ? '执行中…' : '执行下一步'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineSetup;
