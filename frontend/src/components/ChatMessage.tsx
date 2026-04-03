import { useState } from 'react';
import { Card, Typography, Tag, Collapse, Button, Rate, Input, Space, message, Spin } from 'antd';
import { RobotOutlined, CheckCircleOutlined, LoadingOutlined, ExclamationCircleOutlined, ArrowRightOutlined, MessageOutlined } from '@ant-design/icons';
import ChartRenderer from './ChartRenderer';
import DataTable from './DataTable';
import SqlViewer from './SqlViewer';
import StreamingText from './StreamingText';
import api from '../api/client';

export interface ReasoningStepData {
  step_number: number;
  causal_node: string;
  layer: string;
  question: string;
  sql: string;
  data_summary: string;
  finding: string;
  is_abnormal: boolean;
  next_node: string | null;
  upstream_nodes: string[];
}

export interface ChatSteps {
  intent?: boolean;
  sql?: boolean;
  data?: boolean;
  chart?: boolean;
  interpret?: boolean;
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  sqlStep?: number;
  chartSpec?: Record<string, unknown>;
  tableData?: { columns: string[]; rows: unknown[][] };
  intent?: { scenario: string; sub_question?: string };
  loading?: boolean;
  steps?: ChatSteps;
  reasoningMode?: 'causal' | 'single';
  reasoningSteps?: ReasoningStepData[];
  reasoningConclusion?: { conclusion: string; causal_path: string[]; steps_count: number };
  // Multi-step pipeline fields
  expansion?: { original: string; expanded: string };
  graphContext?: { tables: string[]; scenario: string; fields_count: number };
  decomposition?: { steps: Array<{ step: number; question: string; purpose?: string }>; total: number };
  currentStep?: { step: number; total: number; question: string; purpose?: string };
  stepResults?: Array<{ step: number; summary: string; error?: boolean }>;
  multiStepData?: Array<{ step: number; columns: string[]; rows: unknown[][] }>;
  stepSqls?: Record<number, string>;
  logId?: string;
  suggestions?: string[];
}

const LAYER_COLORS: Record<string, string> = {
  '供应层': '#8B5CF6',
  '生产层': '#F59E0B',
  '库存层': '#10B981',
  '销售层': '#3B82F6',
  '客户层': '#EF4444',
  '成本层': '#6366F1',
};

function getLayerColor(layer: string): string {
  return LAYER_COLORS[layer] ?? '#6B7280';
}

/* ============================================================
   AttributionChain — horizontal card chain for causal attribution
   ============================================================ */
function AttributionChain({ msg }: { msg: ChatMsg }) {
  const steps = msg.reasoningSteps ?? [];
  const conclusion = msg.reasoningConclusion;

  // Loading state: no steps yet
  if (msg.loading && steps.length === 0) {
    return (
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 18, color: 'var(--da-primary, #4338ca)' }} spin />} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>正在启动因果推理...</Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {msg.loading ? '多步因果推理中...' : '多步因果推理完成'}
      </Typography.Text>

      {/* Horizontal scrolling card chain */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 0,
          overflowX: 'auto',
          paddingBottom: 8,
        }}
      >
        {steps.map((step, idx) => {
          const layerColor = getLayerColor(step.layer);
          const isLast = idx === steps.length - 1 && !step.next_node;
          const borderColor = step.is_abnormal ? '#EF4444' : '#52c41a';
          const isActive = msg.loading && idx === steps.length - 1 && !conclusion;

          return (
            <div key={step.step_number} style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
              {/* Step card */}
              <div
                style={{
                  width: 220,
                  borderLeft: `4px solid ${layerColor}`,
                  borderTop: `1px solid ${borderColor}`,
                  borderRight: `1px solid ${borderColor}`,
                  borderBottom: `1px solid ${borderColor}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: '#fff',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  position: 'relative',
                }}
              >
                {/* Header row: step label + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {isActive && <LoadingOutlined style={{ marginRight: 4 }} />}
                    Step {step.step_number}
                  </Typography.Text>
                  {step.is_abnormal ? (
                    <Tag color="error" style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>异常</Tag>
                  ) : (
                    <Tag color="success" style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>正常</Tag>
                  )}
                </div>

                {/* Layer tag */}
                <Tag
                  style={{
                    alignSelf: 'flex-start',
                    color: layerColor,
                    borderColor: layerColor,
                    background: `${layerColor}18`,
                    fontSize: 11,
                    margin: 0,
                  }}
                >
                  {step.layer}
                </Tag>

                {/* Causal node name */}
                <Typography.Text strong style={{ fontSize: 13 }}>{step.causal_node}</Typography.Text>

                {/* Data summary */}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{step.data_summary}</Typography.Text>

                {/* Finding */}
                {step.finding && (
                  <Typography.Text style={{ fontSize: 12 }}>{step.finding}</Typography.Text>
                )}

                {/* SQL viewer */}
                {step.sql && (
                  <Collapse
                    size="small"
                    ghost
                    style={{ margin: 0 }}
                    items={[{
                      key: 'sql',
                      label: <span style={{ fontSize: 11, color: '#999' }}>查看SQL</span>,
                      children: <SqlViewer sql={step.sql} />,
                    }]}
                  />
                )}

                {/* Root cause badge on terminal node */}
                {isLast && (
                  <Tag
                    color="volcano"
                    style={{
                      position: 'absolute',
                      top: -10,
                      right: -6,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    根因
                  </Tag>
                )}
              </div>

              {/* Arrow separator between cards */}
              {idx < steps.length - 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 6px',
                    flexShrink: 0,
                    color: '#bbb',
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                >
                  →
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Conclusion box */}
      {conclusion && (
        <Card
          size="small"
          style={{ background: 'var(--da-bg-accent-subtle)', borderColor: 'var(--da-border-active)', marginTop: 12 }}
        >
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            因果路径
          </Typography.Text>
          <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {conclusion.causal_path.map((node, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Tag style={{ color: getLayerColor(node), borderColor: getLayerColor(node), background: `${getLayerColor(node)}18` }}>
                  {node}
                </Tag>
                {i < conclusion.causal_path.length - 1 && (
                  <ArrowRightOutlined style={{ color: '#888', fontSize: 10 }} />
                )}
              </span>
            ))}
          </div>
          <StreamingText text={conclusion.conclusion} loading={false} />
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
            共 {conclusion.steps_count} 步推理
          </Typography.Text>
        </Card>
      )}
    </div>
  );
}

/* ============================================================
   MultiStepPipeline — vertical stack of full-width bordered cards
   ============================================================ */
function MultiStepPipeline({ msg, workspace }: { msg: ChatMsg; workspace?: string }) {
  const decomp = msg.decomposition;
  const stepResults = msg.stepResults ?? [];
  const currentStep = msg.currentStep;
  const multiData = msg.multiStepData ?? [];

  // --- Interactive edit & branch state ---
  const [editedSqls, setEditedSqls] = useState<Record<number, string>>({});
  const [editedResults, setEditedResults] = useState<Record<number, { columns: string[]; rows: unknown[][]; summary: string; error?: string; sql?: string }>>({});
  const [branchInputs, setBranchInputs] = useState<Record<number, string>>({});
  const [rerunLoading, setRerunLoading] = useState<Record<number, boolean>>({});
  const [synthLoading, setSynthLoading] = useState(false);
  const [synthResult, setSynthResult] = useState('');

  const getEffectiveSummary = (stepNum: number): string => {
    if (editedResults[stepNum]) return editedResults[stepNum].summary;
    return stepResults.find(r => r.step === stepNum)?.summary ?? '';
  };

  const rerunStep = async (stepNum: number) => {
    const sql = editedSqls[stepNum] ?? (msg.stepSqls?.[stepNum] ?? '');
    const stepInfo = decomp?.steps.find(s => s.step === stepNum);
    const priorSummaries = (decomp?.steps ?? [])
      .filter(s => s.step < stepNum)
      .map(s => ({ step: s.step, summary: getEffectiveSummary(s.step) }));

    setRerunLoading(prev => ({ ...prev, [stepNum]: true }));
    try {
      const baseUrl = workspace ? `/workspaces/${workspace}` : '';
      const res = await api.post(`${baseUrl}/chat/step/rerun`, {
        sql,
        step: stepNum,
        question: stepInfo?.question ?? '',
        prior_summaries: priorSummaries,
      });
      setEditedResults(prev => ({ ...prev, [stepNum]: res.data }));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      message.error(`重新执行失败: ${errMsg}`);
    } finally {
      setRerunLoading(prev => ({ ...prev, [stepNum]: false }));
    }
  };

  const runBranch = async (afterStep: number) => {
    const question = branchInputs[afterStep] ?? '';
    if (!question.trim()) return;

    const priorSummaries = (decomp?.steps ?? [])
      .filter(s => s.step <= afterStep)
      .map(s => ({ step: s.step, summary: getEffectiveSummary(s.step) }));

    const branchStep = afterStep + 0.5; // use a float key for branch steps
    setRerunLoading(prev => ({ ...prev, [branchStep]: true }));
    try {
      const baseUrl = workspace ? `/workspaces/${workspace}` : '';
      const res = await api.post(`${baseUrl}/chat/step/rerun`, {
        sql: '',
        step: afterStep,
        question: question.trim(),
        prior_summaries: priorSummaries,
      });
      setEditedResults(prev => ({ ...prev, [branchStep]: { ...res.data, _branchQuestion: question, _afterStep: afterStep } as typeof res.data }));
      setBranchInputs(prev => ({ ...prev, [afterStep]: '' }));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      message.error(`分支执行失败: ${errMsg}`);
    } finally {
      setRerunLoading(prev => ({ ...prev, [branchStep]: false }));
    }
  };

  const resynthesize = async () => {
    setSynthLoading(true);
    setSynthResult('');

    const stepResultsPayload = (decomp?.steps ?? []).map(s => {
      const edited = editedResults[s.step];
      const originalSummary = stepResults.find(r => r.step === s.step)?.summary ?? '';
      const originalData = multiData.find(d => d.step === s.step);
      return {
        step: s.step,
        question: s.question,
        summary: edited?.summary ?? originalSummary,
        columns: edited?.columns ?? originalData?.columns ?? [],
        rows: (edited?.rows ?? originalData?.rows ?? []).slice(0, 20),
      };
    });

    try {
      const token = localStorage.getItem('access_token') ?? '';
      const baseUrl = workspace ? `/api/workspaces/${workspace}` : '/api';
      const response = await fetch(`${baseUrl}/chat/step/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ original_question: msg.expansion?.original ?? msg.content ?? '', step_results: stepResultsPayload }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.chunk) setSynthResult(prev => prev + d.chunk);
              if (d.done) setSynthLoading(false);
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      message.error(`重新综合失败: ${errMsg}`);
    } finally {
      setSynthLoading(false);
    }
  };

  const anyStepDone = stepResults.length > 0;

  return (
    <div style={{ marginTop: 8 }}>
      {/* Expansion */}
      {msg.expansion && (
        <div style={{ background: 'var(--da-bg-accent-subtle)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 12 }}>
          <Tag color="blue" style={{ marginRight: 6 }}>意图理解</Tag>
          <Typography.Text type="secondary">{msg.expansion.expanded}</Typography.Text>
        </div>
      )}

      {/* Graph context */}
      {msg.graphContext && (
        <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tag color="purple">知识定位</Tag>
          {msg.graphContext.scenario && (
            <Tag color="cyan">
              {msg.graphContext.scenario}
            </Tag>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>涉及 {msg.graphContext.tables.length} 张业务表</Typography.Text>
        </div>
      )}

      {/* Decomposition step cards — horizontal */}
      {decomp && decomp.total > 1 && (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', paddingBottom: 8, marginTop: 12 }}>
          {decomp.steps.map((s, idx) => {
            const result = stepResults.find(r => r.step === s.step);
            const stepData = multiData.find(d => d.step === s.step);
            const isActive = msg.loading && currentStep?.step === s.step && !result;
            const isDone = !!result;
            const isError = result?.error;
            const editedResult = editedResults[s.step];
            const currentSql = editedSqls[s.step] ?? (msg.stepSqls?.[s.step] ?? '');
            const branchStepKey = s.step + 0.5;
            const branchResult = editedResults[branchStepKey] as (typeof editedResult & { _branchQuestion?: string }) | undefined;

            const topColor = isError ? '#ff4d4f' : isDone ? '#52c41a' : isActive ? 'var(--da-primary, #4338ca)' : '#d9d9d9';

            return (
              <div key={s.step} style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
                {/* Arrow separator */}
                {idx > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', color: '#bbb', fontSize: 18, fontWeight: 700 }}>→</div>
                )}
                {/* Step card */}
                <div
                  style={{
                    width: 340,
                    borderTop: `3px solid ${topColor}`,
                    border: '1px solid var(--da-border-base)',
                    borderTopWidth: 3,
                    borderTopColor: topColor,
                    borderRadius: 8,
                    padding: '10px 14px',
                    background: 'var(--da-bg-elevated)',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {isActive && <LoadingOutlined style={{ color: 'var(--da-primary, #4338ca)', fontSize: 14 }} />}
                    {isDone && !isError && <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />}
                    {isError && <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />}
                    {!isActive && !isDone && (
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#d9d9d9' }} />
                    )}
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      第 {s.step} 步 / {decomp.total}
                    </Typography.Text>
                  </div>

                  {/* Question */}
                  <Typography.Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{s.question}</Typography.Text>

                  {/* Purpose */}
                  {s.purpose && (
                    <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                      {s.purpose}
                    </Typography.Text>
                  )}

                  {/* Result summary */}
                  {result && !isError && !editedResult && (
                    <Typography.Text style={{ fontSize: 12, color: '#52c41a', display: 'block' }}>{result.summary}</Typography.Text>
                  )}
                  {isError && !editedResult && (
                    <div>
                      <Typography.Text type="danger" style={{ fontSize: 12, display: 'block' }}>
                        此步骤执行出错
                      </Typography.Text>
                      <Collapse size="small" ghost items={[{
                        key: 'err',
                        label: <span style={{ fontSize: 11, color: '#999' }}>查看错误详情</span>,
                        children: <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{result?.summary}</Typography.Text>,
                      }]} />
                    </div>
                  )}
                  {editedResult && !editedResult.error && (
                    <Typography.Text style={{ fontSize: 12, color: 'var(--da-primary, #4338ca)', display: 'block' }}>
                      [已更新] {editedResult.summary}
                    </Typography.Text>
                  )}
                  {editedResult?.error && (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>[执行错误] {editedResult.error}</Typography.Text>
                  )}

                  {/* Data + SQL + Branch collapses */}
                  <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                    {stepData && stepData.rows.length > 0 && !editedResult && (
                      <Collapse size="small" ghost items={[{
                        key: 'data',
                        label: <span style={{ fontSize: 11, color: '#999' }}>查看数据 ({stepData.rows.length}行)</span>,
                        children: <DataTable columns={stepData.columns} rows={stepData.rows} maxHeight={150} />,
                      }]} />
                    )}
                    {editedResult && editedResult.columns.length > 0 && (
                      <Collapse size="small" ghost items={[{
                        key: 'edited-data',
                        label: <span style={{ fontSize: 11, color: 'var(--da-primary, #4338ca)' }}>查看数据 ({editedResult.rows.length}行)</span>,
                        children: <DataTable columns={editedResult.columns} rows={editedResult.rows} maxHeight={150} />,
                      }]} />
                    )}
                    {isDone && (
                      <Collapse size="small" ghost items={[{
                        key: 'edit-sql',
                        label: <span style={{ fontSize: 11, color: '#fa8c16' }}>编辑 SQL</span>,
                        children: (
                          <div>
                            <Input.TextArea
                              value={currentSql}
                              onChange={e => setEditedSqls(prev => ({ ...prev, [s.step]: e.target.value }))}
                              rows={3}
                              style={{ fontFamily: 'monospace', fontSize: 11 }}
                              placeholder="输入或粘贴 SQL..."
                            />
                            <Button size="small" type="primary" loading={rerunLoading[s.step]} onClick={() => rerunStep(s.step)} style={{ marginTop: 4 }}>
                              重新执行
                            </Button>
                          </div>
                        ),
                      }]} />
                    )}
                    {isDone && (
                      <div style={{ marginTop: 4 }}>
                        <Button
                          size="small"
                          type="dashed"
                          style={{ fontSize: 11, color: '#722ed1', borderColor: '#d3adf7' }}
                          onClick={() => setBranchInputs(prev => ({
                            ...prev,
                            [s.step]: prev[s.step] === undefined ? '' : prev[s.step],
                          }))}
                        >
                          从此步提问
                        </Button>
                        {branchInputs[s.step] !== undefined && (
                          <Space.Compact size="small" style={{ display: 'flex', marginTop: 4 }}>
                            <Input
                              placeholder="输入新的子问题..."
                              value={branchInputs[s.step]}
                              onChange={e => setBranchInputs(prev => ({ ...prev, [s.step]: e.target.value }))}
                              onPressEnter={() => runBranch(s.step)}
                              style={{ fontSize: 11 }}
                            />
                            <Button type="primary" size="small" loading={rerunLoading[branchStepKey]} onClick={() => runBranch(s.step)}>运行</Button>
                          </Space.Compact>
                        )}
                        {branchResult && (
                          <div style={{ marginTop: 4, background: '#f9f0ff', borderRadius: 6, padding: '6px 10px', border: '1px solid #d3adf7' }}>
                            <Typography.Text style={{ fontSize: 11, color: '#722ed1', display: 'block', marginBottom: 2 }}>
                              分支: {branchResult._branchQuestion}
                            </Typography.Text>
                            {branchResult.error ? (
                              <Typography.Text type="danger" style={{ fontSize: 11 }}>{branchResult.error}</Typography.Text>
                            ) : (
                              <Typography.Text style={{ fontSize: 11 }}>{branchResult.summary}</Typography.Text>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Original interpretation */}
      {(msg.content || (msg.loading && stepResults.length > 0)) && (
        <div style={{ background: 'var(--da-bg-muted)', borderRadius: 12, padding: '16px 20px', border: '1px solid var(--da-border-base)', marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--da-primary)', marginBottom: 8 }}>
            {synthResult ? '原始综合' : '综合分析'}
          </div>
          <StreamingText text={msg.content} loading={msg.loading && !msg.content} />
        </div>
      )}

      {/* Re-synthesize button */}
      {!msg.loading && anyStepDone && (
        <div style={{ marginTop: 12 }}>
          <Button
            size="small"
            type="default"
            loading={synthLoading}
            onClick={resynthesize}
            style={{ color: 'var(--da-primary)', borderColor: 'var(--da-border-active)' }}
          >
            重新综合
          </Button>
        </div>
      )}

      {/* Re-synthesized result */}
      {synthResult && (
        <div style={{ background: 'var(--da-bg-accent-subtle)', borderRadius: 12, padding: '16px 20px', border: '1px solid var(--da-border-active)', marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--da-primary)', marginBottom: 8 }}>修改后综合</div>
          <StreamingText text={synthResult} loading={synthLoading && !synthResult} />
        </div>
      )}
    </div>
  );
}

function FollowUpSuggestions({ suggestions, onFollowUp }: { suggestions: string[]; onFollowUp?: (q: string) => void }) {
  if (!suggestions || suggestions.length === 0 || !onFollowUp) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {suggestions.map((s, i) => (
        <Button
          key={i}
          size="small"
          type="dashed"
          style={{ fontSize: 12, borderRadius: 16, color: 'var(--da-primary)', borderColor: 'var(--da-border-active)' }}
          onClick={() => onFollowUp(s)}
        >
          {s}
        </Button>
      ))}
    </div>
  );
}

function FeedbackBar({ logId, workspace }: { logId?: string; workspace?: string }) {
  const [rating, setRating] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!logId || submitted) {
    return submitted ? (
      <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
        感谢反馈
      </Typography.Text>
    ) : null;
  }

  const handleSubmit = async (r?: number) => {
    const finalRating = r ?? rating;
    try {
      const baseUrl = workspace ? `/workspaces/${workspace}` : '';
      await api.post(`${baseUrl}/logs/${logId}/feedback`, {
        rating: finalRating || undefined,
        feedback: feedbackText || undefined,
      });
      setSubmitted(true);
      message.success('反馈已提交');
    } catch {
      message.error('提交失败');
    }
  };

  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Rate
        value={rating}
        onChange={(v) => { setRating(v); handleSubmit(v); }}
        style={{ fontSize: 14 }}
      />
      <Button
        type="text"
        size="small"
        icon={<MessageOutlined />}
        onClick={() => setShowFeedback(!showFeedback)}
        style={{ fontSize: 11, color: '#999' }}
      >
        反馈
      </Button>
      {showFeedback && (
        <Space.Compact size="small" style={{ flex: 1, minWidth: 200 }}>
          <Input
            placeholder="补充反馈..."
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            onPressEnter={() => handleSubmit()}
            style={{ fontSize: 12 }}
          />
          <Button type="primary" size="small" onClick={() => handleSubmit()}>提交</Button>
        </Space.Compact>
      )}
    </div>
  );
}

interface ChatMessageProps {
  msg: ChatMsg;
  onFollowUp?: (question: string) => void;
  workspace?: string;
}

export default function ChatMessage({ msg, onFollowUp, workspace }: ChatMessageProps) {
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Card
          size="small"
          style={{
            maxWidth: '70%',
            background: 'var(--da-primary)',
            borderColor: 'var(--da-primary)',
            borderRadius: '16px 16px 4px 16px',
          }}
        >
          <Typography.Text style={{ color: '#fff' }}>{msg.content}</Typography.Text>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <RobotOutlined style={{ fontSize: 20, color: 'var(--da-primary)', marginTop: 4 }} />
        <div style={{ flex: 1 }}>
          {msg.reasoningMode === 'causal' ? (
            <AttributionChain msg={msg} />
          ) : msg.decomposition && msg.decomposition.total > 1 ? (
            <MultiStepPipeline msg={msg} workspace={workspace} />
          ) : (
            <>
              {/* Pipeline progress tags */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                {msg.loading && !msg.steps?.intent && (
                  <Tag icon={<LoadingOutlined />} color="processing">分析中</Tag>
                )}
                {msg.expansion && (
                  <Tag color="blue">意图理解</Tag>
                )}
                {msg.graphContext && (
                  <>
                    <Tag color="purple">知识定位</Tag>
                    {msg.graphContext.scenario && (
                      <Tag color="cyan">
                        {msg.graphContext.scenario}
                      </Tag>
                    )}
                  </>
                )}
                {msg.steps?.sql && <Tag color="geekblue">SQL</Tag>}
                {msg.steps?.data && <Tag color="green">数据</Tag>}
                {msg.steps?.chart && <Tag color="lime">图表</Tag>}
                {msg.loading && msg.steps?.data && !msg.content && (
                  <Tag icon={<LoadingOutlined />} color="processing">解读中</Tag>
                )}
              </div>

              {msg.sql && <SqlViewer sql={msg.sql} />}

              {msg.chartSpec && (
                <div style={{ margin: '12px 0' }}>
                  <ChartRenderer spec={msg.chartSpec as unknown as Parameters<typeof ChartRenderer>[0]['spec']} />
                </div>
              )}

              {msg.tableData && msg.tableData.rows.length > 0 && (
                <div style={{ margin: '12px 0' }}>
                  <DataTable
                    columns={msg.tableData.columns}
                    rows={msg.tableData.rows}
                    maxHeight={200}
                  />
                </div>
              )}

              {(msg.content || (msg.loading && msg.steps?.data === true && !msg.steps?.interpret)) && (
                <div style={{ background: 'var(--da-bg-muted)', borderRadius: 12, padding: '16px 20px', border: '1px solid var(--da-border-base)', marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--da-primary)', marginBottom: 8 }}>AI 解读</div>
                  <StreamingText
                    text={msg.content}
                    loading={msg.loading && msg.steps?.data === true && !msg.steps?.interpret}
                  />
                </div>
              )}
            </>
          )}

          {/* Follow-up suggestions */}
          {!msg.loading && msg.suggestions && msg.suggestions.length > 0 && (
            <FollowUpSuggestions suggestions={msg.suggestions} onFollowUp={onFollowUp} />
          )}

          {/* Rating & feedback */}
          {!msg.loading && msg.content && (
            <FeedbackBar logId={msg.logId} workspace={workspace} />
          )}
        </div>
      </div>
    </div>
  );
}
