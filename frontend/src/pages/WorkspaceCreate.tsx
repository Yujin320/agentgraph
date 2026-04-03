import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message, Card, Typography } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import { pipelineApi } from '../api/client';

const { Title, Paragraph } = Typography;

interface CreateFormValues {
  name: string;
  db_url: string;
  title?: string;
  description?: string;
}

const WorkspaceCreate: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm<CreateFormValues>();
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (values: CreateFormValues) => {
    setLoading(true);
    try {
      await pipelineApi.createWorkspace(values);
      message.success('工作空间创建成功，正在初始化流程…');
      await pipelineApi.createPipeline(values.name);
      navigate(`/w/${values.name}/setup`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err as Error)?.message ??
        '创建失败';
      message.error(`创建失败：${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f0f2f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <Card
        style={{ width: '100%', maxWidth: 520, borderRadius: 12 }}
        styles={{ body: { padding: '40px 40px 32px' } }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <DatabaseOutlined style={{ fontSize: 24, color: '#4f46e5' }} />
          <Title level={3} style={{ margin: 0 }}>
            创建新工作空间
          </Title>
        </div>
        <Paragraph style={{ color: '#888', marginBottom: 28 }}>
          填写数据库连接信息，系统将自动初始化知识库构建流程。
        </Paragraph>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
        >
          <Form.Item
            label="工作空间名称"
            name="name"
            rules={[
              { required: true, message: '请输入工作空间名称' },
              {
                pattern: /^[a-z0-9_-]+$/,
                message: '只允许小写字母、数字、下划线和连字符',
              },
            ]}
          >
            <Input placeholder="例如：sales_data" size="large" />
          </Form.Item>

          <Form.Item
            label="数据库连接地址（DB URL）"
            name="db_url"
            rules={[{ required: true, message: '请输入数据库连接地址' }]}
          >
            <Input
              placeholder="例如：sqlite:///data.db 或 postgresql://user:pass@host/db"
              size="large"
            />
          </Form.Item>

          <Form.Item label="显示标题（可选）" name="title">
            <Input placeholder="例如：销售数据分析" size="large" />
          </Form.Item>

          <Form.Item label="描述（可选）" name="description">
            <Input.TextArea
              placeholder="简要描述此工作空间的用途"
              rows={3}
              size="large"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              size="large"
              block
              style={{ background: '#4f46e5', borderColor: '#4f46e5' }}
            >
              创建并开始配置
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default WorkspaceCreate;
