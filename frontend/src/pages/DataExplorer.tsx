import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Layout, Result, Typography } from 'antd';
import { ArrowLeftOutlined, ExperimentOutlined } from '@ant-design/icons';

const { Header, Content } = Layout;
const { Text } = Typography;

const DataExplorer: React.FC = () => {
  const { workspace = '' } = useParams<{ workspace: string }>();
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh' }}>
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
          onClick={() => navigate(`/w/${workspace}`)}
        />
        <ExperimentOutlined style={{ color: '#4f46e5' }} />
        <Text strong style={{ fontSize: 16 }}>
          数据探索 — {workspace}
        </Text>
      </Header>

      <Content
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
        }}
      >
        <Result
          icon={<ExperimentOutlined style={{ color: '#4f46e5' }} />}
          title="数据探索器"
          subTitle={`工作空间「${workspace}」的数据浏览功能正在开发中。后端 API 已就绪：/api/explorer/${workspace}/tables`}
          extra={[
            <Button
              key="chat"
              type="primary"
              style={{ background: '#4f46e5', borderColor: '#4f46e5' }}
              onClick={() => navigate(`/w/${workspace}`)}
            >
              返回对话
            </Button>,
            <Button key="home" onClick={() => navigate('/')}>
              工作空间列表
            </Button>,
          ]}
        />
      </Content>
    </Layout>
  );
};

export default DataExplorer;
