import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Form, Input, Button, message, Descriptions, Badge, Typography,
  Space, Alert, Radio, Row, Col, Tag, Spin, Divider, List,
} from 'antd';
import {
  SettingOutlined, CheckCircleOutlined, ApiOutlined, SafetyOutlined,
  DatabaseOutlined, ReloadOutlined, ArrowRightOutlined,
} from '@ant-design/icons';
import api from '../api/client';

const { Title, Text } = Typography;

// ─── LLM Presets ─────────────────────────────────────────────────────────────

const PRESETS: Record<string, { label: string; base_url: string; model: string }> = {
  kimi: {
    label: 'Kimi K2.5',
    base_url: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.5',
  },
  gemini: {
    label: 'Gemini Flash',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
  },
  openai: {
    label: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  custom: {
    label: '自定义',
    base_url: '',
    model: '',
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthData {
  status: string;
  checks?: {
    database?: boolean;
    neo4j?: boolean;
    knowledge?: boolean;
  };
  version?: string;
}

interface ConfigData {
  base_url?: string;
  model?: string;
  api_key?: string;
}

interface WorkspaceSummary {
  name: string;
  title?: string;
  description?: string;
  pipeline_status?: string;
}

// ─── Section 1: System Health ─────────────────────────────────────────────────

function SystemHealthCard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/system/health')
      .then(res => { setHealth(res.data); setLoading(false); })
      .catch(() => { setHealth(null); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const statusBadge = (ok: boolean | undefined, okText: string, failText: string) => (
    <Badge
      status={ok ? 'success' : ok === false ? 'error' : 'default'}
      text={ok ? okText : ok === false ? failText : '未知'}
    />
  );

  return (
    <Card
      title={<><CheckCircleOutlined /> 系统状态</>}
      style={{ marginBottom: 24 }}
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
      ) : health ? (
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="整体状态">
            <Badge
              status={health.status === 'ok' ? 'success' : 'warning'}
              text={
                <Text strong style={{ color: health.status === 'ok' ? '#52c41a' : '#faad14' }}>
                  {health.status === 'ok' ? '正常运行' : '部分异常'}
                </Text>
              }
            />
          </Descriptions.Item>
          <Descriptions.Item label="数据库">
            {statusBadge(health.checks?.database, '已连接', '未连接')}
          </Descriptions.Item>
          <Descriptions.Item label="Neo4j 图数据库">
            {statusBadge(health.checks?.neo4j, '已连接', '未连接')}
          </Descriptions.Item>
          <Descriptions.Item label="知识库">
            {statusBadge(health.checks?.knowledge, '已加载', '未加载')}
          </Descriptions.Item>
          {health.version && (
            <Descriptions.Item label="版本">
              <Tag color="geekblue">{health.version}</Tag>
            </Descriptions.Item>
          )}
        </Descriptions>
      ) : (
        <Alert type="error" message="无法获取系统状态，服务可能异常" showIcon />
      )}
    </Card>
  );
}

// ─── Section 2: LLM Config ────────────────────────────────────────────────────

function LLMConfigCard() {
  const [form] = Form.useForm();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [preset, setPreset] = useState<string>('custom');

  const detectPreset = (base_url: string, model: string) => {
    for (const [key, p] of Object.entries(PRESETS)) {
      if (key !== 'custom' && p.base_url === base_url && p.model === model) return key;
    }
    return 'custom';
  };

  const loadConfig = () => {
    api.get('/system/config').then(res => {
      setConfig(res.data);
      form.setFieldsValue({
        base_url: res.data.base_url,
        model: res.data.model,
        api_key: '',
      });
      setPreset(detectPreset(res.data.base_url, res.data.model));
    }).catch(() => {});
  };

  useEffect(() => { loadConfig(); }, []);

  const handlePresetChange = (key: string) => {
    setPreset(key);
    if (key !== 'custom') {
      form.setFieldsValue({ base_url: PRESETS[key].base_url, model: PRESETS[key].model });
    }
    setSaveSuccess(false);
    setTestResult(null);
  };

  const handleTest = () => {
    setTesting(true);
    setTestResult(null);
    api.post('/system/test-connection')
      .then(res => {
        setTestResult(res.data);
        if (res.data.status === 'ok') message.success('连接测试成功');
        else message.error(res.data.error || '连接失败');
        setTesting(false);
      })
      .catch(() => {
        message.error('请求失败，请检查网络');
        setTesting(false);
      });
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    const payload: Record<string, string> = {};
    if (values.base_url) payload.base_url = values.base_url;
    if (values.model) payload.model = values.model;
    if (values.api_key) payload.api_key = values.api_key;

    api.put('/system/config', payload)
      .then(res => {
        message.success('配置已更新');
        const newConfig = res.data.config ?? res.data;
        setConfig(newConfig);
        setSaveSuccess(true);
        setSaving(false);
      })
      .catch(() => {
        message.error('保存失败，请检查参数');
        setSaving(false);
      });
  };

  return (
    <Card title={<><ApiOutlined /> LLM API 配置</>} style={{ marginBottom: 24 }}>
      {/* Current config display */}
      {config && (
        <div style={{ marginBottom: 20, padding: 12, background: '#f7f8fa', borderRadius: 8, border: '1px solid #e8e8e8' }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>当前配置</Text>
          <Row gutter={16}>
            <Col span={12}>
              <Text style={{ fontSize: 12 }}>Base URL：</Text>
              <Text code style={{ fontSize: 11 }}>{config.base_url || '—'}</Text>
            </Col>
            <Col span={6}>
              <Text style={{ fontSize: 12 }}>模型：</Text>
              <Text code style={{ fontSize: 11 }}>{config.model || '—'}</Text>
            </Col>
            <Col span={6}>
              <Text style={{ fontSize: 12 }}>API Key：</Text>
              <Text code style={{ fontSize: 11 }}>{config.api_key || '—'}</Text>
            </Col>
          </Row>
        </div>
      )}

      {/* Preset selector */}
      <div style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 13, marginRight: 12 }}>切换预设：</Text>
        <Radio.Group value={preset} onChange={e => handlePresetChange(e.target.value)}>
          {Object.entries(PRESETS).map(([key, p]) => (
            <Radio.Button key={key} value={key}>{p.label}</Radio.Button>
          ))}
        </Radio.Group>
      </div>

      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="API Base URL" name="base_url">
              <Input
                placeholder="https://api.moonshot.cn/v1"
                disabled={preset !== 'custom'}
                onChange={() => setSaveSuccess(false)}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="模型名称" name="model">
              <Input
                placeholder="kimi-k2.5"
                disabled={preset !== 'custom'}
                onChange={() => setSaveSuccess(false)}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="API Key" name="api_key">
          <Input.Password
            placeholder="留空则保持当前 Key 不变"
            onChange={() => setSaveSuccess(false)}
          />
        </Form.Item>
        <Space wrap>
          <Button
            type="primary"
            onClick={handleSave}
            loading={saving}
            style={{ background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)' }}
          >
            保存配置
          </Button>
          <Button onClick={handleTest} loading={testing} icon={<CheckCircleOutlined />}>
            测试连接
          </Button>
        </Space>
      </Form>

      {saveSuccess && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          message="配置已保存"
          description={`当前模型：${config?.model}，Base URL：${config?.base_url}`}
          showIcon
          closable
          onClose={() => setSaveSuccess(false)}
        />
      )}

      {testResult && (
        <Alert
          style={{ marginTop: 16 }}
          type={testResult.status === 'ok' ? 'success' : 'error'}
          message={testResult.status === 'ok' ? '连接成功' : '连接失败'}
          description={
            testResult.status === 'ok'
              ? (testResult.response || '模型响应正常')
              : (testResult.error || '连接异常')
          }
          showIcon
          closable
          onClose={() => setTestResult(null)}
        />
      )}
    </Card>
  );
}

// ─── Section 3: Workspace Management ─────────────────────────────────────────

function WorkspaceManagementCard() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/workspaces')
      .then(res => { setWorkspaces(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const pipelineStatusColor = (status?: string) => {
    if (!status) return 'default';
    if (status === 'completed') return 'success';
    if (status === 'running') return 'processing';
    if (status === 'failed') return 'error';
    return 'default';
  };

  const pipelineStatusText = (status?: string) => {
    const map: Record<string, string> = {
      completed: '已完成',
      running: '运行中',
      failed: '失败',
      pending: '未开始',
      in_progress: '进行中',
    };
    return map[status ?? ''] ?? (status || '未知');
  };

  return (
    <Card
      title={<><DatabaseOutlined /> 工作空间管理</>}
      style={{ marginBottom: 24 }}
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={load} />
          <Button
            type="primary"
            size="small"
            style={{ background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)' }}
            onClick={() => navigate('/create')}
          >
            新建工作空间
          </Button>
        </Space>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : workspaces.length === 0 ? (
        <Alert
          type="info"
          message="暂无工作空间"
          description="点击右上角「新建工作空间」开始创建"
          showIcon
        />
      ) : (
        <List
          dataSource={workspaces}
          size="small"
          renderItem={ws => (
            <List.Item
              actions={[
                <Button
                  size="small"
                  key="chat"
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  style={{ background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)' }}
                  onClick={() => navigate(`/w/${ws.name}`)}
                >
                  进入分析
                </Button>,
                <Button
                  size="small"
                  key="setup"
                  icon={<SettingOutlined />}
                  onClick={() => navigate(`/w/${ws.name}/setup`)}
                >
                  Pipeline
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Text strong>{ws.title || ws.name}</Text>
                    <Tag color="geekblue" style={{ fontSize: 11 }}>{ws.name}</Tag>
                    {ws.pipeline_status && (
                      <Badge
                        status={pipelineStatusColor(ws.pipeline_status) as any}
                        text={
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {pipelineStatusText(ws.pipeline_status)}
                          </Text>
                        }
                      />
                    )}
                  </Space>
                }
                description={ws.description || '暂无描述'}
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}

// ─── Section 4: Access Token ──────────────────────────────────────────────────

function AccessTokenCard() {
  const [tokenPreview, setTokenPreview] = useState<string>('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token') || '';
    if (token) {
      setTokenPreview(token.length > 8 ? token.slice(0, 4) + '****' + token.slice(-4) : '****');
    } else {
      setTokenPreview('（未设置）');
    }
  }, []);

  const handleTokenChange = () => {
    const newToken = prompt('请输入新的访问令牌（留空取消）:');
    if (!newToken) return;
    setUpdating(true);
    localStorage.setItem('access_token', newToken);
    document.cookie = `access_token=${encodeURIComponent(newToken)}; path=/; SameSite=Lax`;
    setTimeout(() => {
      setTokenPreview(newToken.length > 8 ? newToken.slice(0, 4) + '****' + newToken.slice(-4) : '****');
      setUpdating(false);
      message.success('访问令牌已更新，刷新页面生效');
    }, 300);
  };

  const handleClearToken = () => {
    localStorage.removeItem('access_token');
    document.cookie = 'access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    setTokenPreview('（已清除）');
    message.info('令牌已清除');
  };

  return (
    <Card title={<><SafetyOutlined /> 访问令牌</>}>
      <Descriptions column={1} size="small">
        <Descriptions.Item label="当前令牌">
          <Text code style={{ fontSize: 13 }}>{tokenPreview}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="存储位置">
          <Tag>localStorage</Tag>
          <Tag>Cookie</Tag>
        </Descriptions.Item>
      </Descriptions>
      <Divider style={{ margin: '12px 0' }} />
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        访问令牌用于保护 API 接口，更换令牌后刷新页面即可生效。令牌同时存储于 localStorage 和 Cookie 以确保兼容性。
      </Text>
      <Space>
        <Button
          type="primary"
          onClick={handleTokenChange}
          loading={updating}
          style={{ background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)' }}
        >
          更换访问令牌
        </Button>
        <Button danger onClick={handleClearToken}>
          清除令牌
        </Button>
      </Space>
    </Card>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function SystemConfig() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <SettingOutlined style={{ color: 'var(--da-primary, #4338ca)', marginRight: 8 }} />
          系统配置
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          系统状态 · LLM 配置 · 工作空间管理 · 访问令牌
        </Text>
      </div>

      <SystemHealthCard />
      <LLMConfigCard />
      <WorkspaceManagementCard />
      <AccessTokenCard />
    </div>
  );
}
