import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Row, Spin, Typography, Alert, Tag, Button } from 'antd';
import { ArrowRightOutlined, DatabaseOutlined, PlusOutlined } from '@ant-design/icons';
import api from '../api/client';

const { Title, Paragraph, Text } = Typography;

interface WorkspaceSummary {
  name: string;
  title: string;
  description: string;
}

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<WorkspaceSummary[]>('/workspaces')
      .then((res) => setWorkspaces(res.data))
      .catch((err) => setError(err.message ?? 'Failed to load workspaces'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '48px 24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <Title level={1} style={{ margin: 0, color: '#1a1a2e' }}>
            DataAgent 智能归因
          </Title>
          <Paragraph style={{ color: '#666', fontSize: 15, marginTop: 8 }}>
            选择一个工作空间开始分析
          </Paragraph>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            style={{ marginTop: 16, background: '#4f46e5', borderColor: '#4f46e5' }}
            onClick={() => navigate('/create')}
          >
            创建新工作空间
          </Button>
        </div>

        {/* Workspace grid */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        )}

        {error && (
          <Alert
            type="error"
            message="加载失败"
            description={error}
            showIcon
            style={{ marginBottom: 24 }}
          />
        )}

        {!loading && !error && workspaces.length === 0 && (
          <Alert
            type="info"
            message="暂无可用工作空间"
            description="请在 workspaces/ 目录下创建至少一个工作空间配置。"
            showIcon
          />
        )}

        <Row gutter={[24, 24]}>
          {workspaces.map((ws) => (
            <Col key={ws.name} xs={24} sm={12} md={8}>
              <Card
                hoverable
                onClick={() => navigate(`/w/${ws.name}`)}
                style={{ height: '100%', borderRadius: 12, cursor: 'pointer' }}
                styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12, height: '100%' } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DatabaseOutlined style={{ color: '#4f46e5', fontSize: 20 }} />
                  <Text strong style={{ fontSize: 16 }}>
                    {ws.title}
                  </Text>
                </div>

                <Tag color="geekblue" style={{ width: 'fit-content' }}>
                  {ws.name}
                </Tag>

                <Paragraph
                  style={{ color: '#666', fontSize: 13, flex: 1, margin: 0 }}
                  ellipsis={{ rows: 3 }}
                >
                  {ws.description || '暂无描述'}
                </Paragraph>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text
                    style={{ color: '#4f46e5', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/w/${ws.name}/explore`);
                    }}
                  >
                    数据探索
                  </Text>
                  <ArrowRightOutlined style={{ color: '#999' }} />
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    </div>
  );
};

export default Home;
