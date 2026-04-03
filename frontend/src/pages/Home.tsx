import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Row,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  BarChartOutlined,
  BranchesOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import api from '../api/client';
import { useTheme } from '../contexts/ThemeContext';

const { Title, Paragraph, Text } = Typography;

interface WorkspaceSummary {
  name: string;
  title: string;
  description: string;
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

const Section: React.FC<{
  bg?: string;
  id?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ bg, id, children, style }) => {
  const { colors } = useTheme();
  return (
    <section
      id={id}
      style={{
        background: bg ?? colors.bgElevated,
        padding: '72px 24px',
        ...style,
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>{children}</div>
    </section>
  );
};

const SectionTitle: React.FC<{ children: React.ReactNode; sub?: string }> = ({
  children,
  sub,
}) => {
  const { colors } = useTheme();
  return (
    <div style={{ textAlign: 'center', marginBottom: 48 }} className="da-animate-in">
      <h2 style={{
        margin: 0,
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontSize: 32,
        fontWeight: 400,
        color: colors.textPrimary,
      }}>
        {children}
      </h2>
      {sub && (
        <Paragraph style={{ color: colors.textSecondary, marginTop: 8, fontSize: 15 }}>
          {sub}
        </Paragraph>
      )}
    </div>
  );
};

/* ── Theme Toggle for Home Page ─────────────────────────────────────────── */
function HomeThemeToggle() {
  const { mode, toggleTheme } = useTheme();
  return (
    <button
      className="da-theme-toggle"
      onClick={toggleTheme}
      title={mode === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
      aria-label="Toggle theme"
      style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }}
    >
      {mode === 'light' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      )}
    </button>
  );
}

/* ── Home Page ───────────────────────────────────────────────────────────── */

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { colors, mode } = useTheme();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const architectureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<WorkspaceSummary[]>('/workspaces')
      .then((res) => setWorkspaces(res.data))
      .catch((err) => setError(err.message ?? '无法加载工作空间列表'))
      .finally(() => setLoading(false));
  }, []);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  /* ── 1. Hero ─────────────────────────────────────────────────────── */
  const hero = (
    <section
      className="da-hero-gradient"
      style={{
        background: colors.heroGradient,
        backgroundSize: '200% 200%',
        padding: '96px 24px 80px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Animated gradient orbs */}
      <div style={{
        position: 'absolute', top: '-20%', left: '-10%', width: '50%', height: '80%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(60px)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-20%', right: '-10%', width: '40%', height: '70%',
        background: 'radial-gradient(circle, rgba(217,119,6,0.1) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(60px)',
      }} />

      <div style={{ maxWidth: 800, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <Tag
          color={colors.primary}
          style={{ marginBottom: 20, fontSize: 13, padding: '3px 12px', borderRadius: 20 }}
          className="da-animate-in-1"
        >
          智能数据分析平台
        </Tag>

        <h1
          className="da-animate-in-2"
          style={{
            color: '#fff',
            margin: '0 0 16px',
            fontSize: 52,
            lineHeight: 1.15,
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontWeight: 400,
          }}
        >
          DataAgent
          <br />
          <span style={{ color: '#a5b4fc' }}>智能数据分析平台</span>
        </h1>

        <Paragraph
          className="da-animate-in-3"
          style={{ color: '#c7d2fe', fontSize: 18, marginBottom: 12, lineHeight: 1.7 }}
        >
          从数据连接到因果归因，一站式智能分析
        </Paragraph>

        <Paragraph
          className="da-animate-in-4"
          style={{ color: '#94a3b8', fontSize: 15, marginBottom: 40, lineHeight: 1.8 }}
        >
          自动理解数据语义、构建因果知识图谱、支持自然语言问数与多路归因分析
        </Paragraph>

        <Space size={16} wrap style={{ justifyContent: 'center' }} className="da-animate-in-5">
          <Button
            type="primary"
            size="large"
            icon={<ArrowRightOutlined />}
            style={{
              background: colors.primary,
              borderColor: colors.primary,
              height: 48,
              paddingInline: 28,
              fontSize: 16,
              borderRadius: 12,
            }}
            onClick={() => scrollTo(workspaceRef)}
          >
            开始使用
          </Button>
          <Button
            size="large"
            style={{
              height: 48,
              paddingInline: 28,
              fontSize: 16,
              background: 'rgba(255,255,255,0.08)',
              borderColor: 'rgba(165,180,252,0.3)',
              color: '#a5b4fc',
              borderRadius: 12,
              backdropFilter: 'blur(8px)',
            }}
            onClick={() => scrollTo(architectureRef)}
          >
            查看文档
          </Button>
        </Space>
      </div>
    </section>
  );

  /* ── 2. Feature Cards ────────────────────────────────────────────── */
  const features = (
    <Section>
      <SectionTitle sub="三大核心能力，覆盖数据分析全链路">系统核心能力</SectionTitle>
      <Row gutter={[24, 24]}>
        {[
          {
            icon: <DatabaseOutlined style={{ fontSize: 32, color: colors.primary }} />,
            title: '语义理解',
            desc: '自动发现数据库 Schema，LLM 标注中文别名与业务描述，生成完整数据字典，让 AI 真正读懂你的数据结构。',
            tags: ['SQLite', 'PostgreSQL', 'CSV/Excel'],
            iconBg: colors.primarySubtle,
            delay: 1,
          },
          {
            icon: <ClusterOutlined style={{ fontSize: 32, color: colors.purple }} />,
            title: '知识图谱',
            desc: '自动构建因果知识图谱（Neo4j），识别指标间因果关系、下钻路径和业务场景入口，形成可视化业务地图。',
            tags: ['Neo4j', '因果推断', '场景识别'],
            iconBg: colors.bgPurpleSubtle,
            delay: 2,
          },
          {
            icon: <BulbOutlined style={{ fontSize: 32, color: colors.emerald }} />,
            title: '智能分析',
            desc: '自然语言提问 → KG 引导 SQL 生成 → 多路因果归因，全程 AI 驱动，覆盖问数与溯因两大分析场景。',
            tags: ['Text-to-SQL', '多路归因', 'SSE 流式'],
            iconBg: colors.bgGreenSubtle,
            delay: 3,
          },
        ].map((f) => (
          <Col key={f.title} xs={24} md={8}>
            <Card
              className={`da-card-hover da-animate-in-${f.delay}`}
              style={{
                height: '100%',
                borderRadius: 16,
                border: `1px solid ${colors.borderBase}`,
                background: colors.bgCard,
                boxShadow: colors.shadowCard,
              }}
              styles={{ body: { padding: 32, display: 'flex', flexDirection: 'column', gap: 16 } }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  background: f.iconBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {f.icon}
              </div>
              <Title level={4} style={{ margin: 0, color: colors.textPrimary }}>
                {f.title}
              </Title>
              <Paragraph style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 1.8, margin: 0 }}>
                {f.desc}
              </Paragraph>
              <Space wrap>
                {f.tags.map((t) => (
                  <Tag key={t} color="blue">
                    {t}
                  </Tag>
                ))}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </Section>
  );

  /* ── 3. Architecture ─────────────────────────────────────────────── */
  const architecture = (
    <Section bg={colors.bgMuted} id="architecture">
      <div ref={architectureRef} />
      <SectionTitle sub="五阶段知识构建 + 两种运行时分析模式">
        系统架构与工作流程
      </SectionTitle>

      <Card
        style={{
          borderRadius: 16,
          marginBottom: 32,
          border: `1px solid ${colors.borderBase}`,
          background: colors.bgCard,
          boxShadow: colors.shadowCard,
        }}
        styles={{ body: { padding: '32px 40px' } }}
      >
        <Title level={4} style={{ marginBottom: 24, color: colors.textPrimary }}>
          <SettingOutlined style={{ marginRight: 8, color: colors.primary }} />
          后端处理流程 — 5 个知识库构建阶段
        </Title>
        <Steps
          direction="horizontal"
          responsive={false}
          style={{ overflowX: 'auto' }}
          items={[
            {
              title: '数据连接',
              description: '支持 SQLite / PostgreSQL / MySQL，或上传 CSV / Excel',
              icon: <DatabaseOutlined style={{ color: colors.primary }} />,
            },
            {
              title: 'Schema 发现',
              description: '自动推断字段类型、外键关系、字段角色',
              icon: <SearchOutlined style={{ color: colors.purple }} />,
            },
            {
              title: '语义标注',
              description: 'LLM 生成中文别名和业务描述，支持人工审核修改',
              icon: <FileSearchOutlined style={{ color: colors.emerald }} />,
            },
            {
              title: '知识图谱',
              description: '推断因果关系，写入 Neo4j（指标→原因→维度→场景）',
              icon: <ApartmentOutlined style={{ color: '#059669' }} />,
            },
            {
              title: 'SQL 训练',
              description: '自动生成问答对，建立 ChromaDB 向量索引',
              icon: <BranchesOutlined style={{ color: colors.accent }} />,
            },
          ]}
        />
      </Card>

      <Title level={4} style={{ marginBottom: 16, color: colors.textPrimary, textAlign: 'center' }}>
        <BarChartOutlined style={{ marginRight: 8, color: colors.primary }} />
        前端交互模式 — 2 种运行时
      </Title>
      <Row gutter={[24, 24]}>
        {[
          {
            title: '智能问数',
            subtitle: 'Text-to-SQL',
            color: colors.primary,
            bg: colors.bgAccentSubtle,
            icon: <SearchOutlined style={{ fontSize: 28, color: colors.primary }} />,
            trigger: '自然语言提问',
            steps: [
              'KG 子图检索 → 聚焦相关 Schema',
              'LLM 生成 SQL → 执行查询',
              '结构化结果 + 自然语言解读',
            ],
            use: '适合：查数据、看指标、对比分析',
          },
          {
            title: '多路归因',
            subtitle: 'Attribution',
            color: colors.purple,
            bg: colors.bgPurpleSubtle,
            icon: <ShareAltOutlined style={{ fontSize: 28, color: colors.purple }} />,
            trigger: '"为什么 XX 异常？"',
            steps: [
              'KG 因果边遍历 → 多条路径',
              '逐节点 SQL 验证 → 量化影响',
              '评分排序 → 归因报告',
            ],
            use: '适合：找根因、溯源分析、异常诊断',
          },
        ].map((m) => (
          <Col key={m.title} xs={24} md={12}>
            <Card
              className="da-card-hover"
              style={{
                borderRadius: 16,
                border: `1px solid ${colors.borderBase}`,
                background: m.bg,
                height: '100%',
              }}
              styles={{ body: { padding: 28 } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: colors.bgElevated,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: colors.shadowCard,
                  }}
                >
                  {m.icon}
                </div>
                <div>
                  <Title level={4} style={{ margin: 0, color: m.color }}>
                    {m.title}
                  </Title>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>{m.subtitle}</Text>
                </div>
              </div>

              <Tag color={m.color} style={{ marginBottom: 12, fontSize: 13 }}>
                触发方式：{m.trigger}
              </Tag>

              <div style={{ marginBottom: 12 }}>
                {m.steps.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        minWidth: 22,
                        height: 22,
                        borderRadius: 11,
                        background: m.color,
                        color: '#fff',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 1,
                      }}
                    >
                      {i + 1}
                    </div>
                    <Text style={{ fontSize: 14, color: colors.textPrimary, lineHeight: 1.6 }}>{s}</Text>
                  </div>
                ))}
              </div>

              <div
                style={{
                  background: colors.bgElevated,
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 13,
                  color: colors.textSecondary,
                }}
              >
                {m.use}
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </Section>
  );

  /* ── 4. Tech Stack ───────────────────────────────────────────────── */
  const techStack = (
    <Section
      bg={mode === 'dark' ? '#0c0c14' : '#1e1b4b'}
      style={{ padding: '40px 24px' }}
    >
      <div style={{ textAlign: 'center' }}>
        <Text style={{ color: '#94a3b8', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>
          技术栈
        </Text>
        <div style={{ marginTop: 16 }}>
          <Space wrap size={12} style={{ justifyContent: 'center' }}>
            {[
              'FastAPI',
              'React',
              'Neo4j',
              'ChromaDB',
              'LangChain',
              'SQLAlchemy',
              'SSE Streaming',
              'TypeScript',
              'Ant Design',
            ].map((tech) => (
              <Tag
                key={tech}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#a5b4fc',
                  fontSize: 14,
                  padding: '4px 14px',
                  borderRadius: 20,
                }}
              >
                {tech}
              </Tag>
            ))}
          </Space>
        </div>
      </div>
    </Section>
  );

  /* ── 5. Workspace ────────────────────────────────────────────────── */
  const workspaceSection = (
    <Section id="workspace">
      <div ref={workspaceRef} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <h2 style={{
            margin: 0,
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 28,
            fontWeight: 400,
            color: colors.textPrimary,
          }}>
            工作空间
          </h2>
          <Paragraph style={{ color: colors.textSecondary, marginTop: 4, marginBottom: 0 }}>
            选择已有工作空间，或创建新的工作空间开始分析
          </Paragraph>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="large"
          style={{
            background: colors.primary,
            borderColor: colors.primary,
            height: 44,
            borderRadius: 12,
          }}
          onClick={() => navigate('/create')}
        >
          创建新工作空间
        </Button>
      </div>

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
          message="暂无工作空间"
          description="点击右上角「创建新工作空间」，提供数据库连接地址或上传文件即可开始。"
          showIcon
        />
      )}

      <Row gutter={[24, 24]}>
        {workspaces.map((ws, idx) => (
          <Col key={ws.name} xs={24} sm={12} lg={8}>
            <Card
              className={`da-card-hover da-animate-in-${Math.min(idx + 1, 5)}`}
              style={{
                height: '100%',
                borderRadius: 16,
                border: `1px solid ${colors.borderBase}`,
                background: colors.bgCard,
                boxShadow: colors.shadowCard,
              }}
              styles={{
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  height: '100%',
                  padding: 24,
                },
              }}
              hoverable
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: colors.primarySubtle,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <DatabaseOutlined style={{ color: colors.primary, fontSize: 18 }} />
                </div>
                <div>
                  <Text strong style={{ fontSize: 16, color: colors.textPrimary }}>
                    {ws.title || ws.name}
                  </Text>
                  <br />
                  <Tag color="geekblue" style={{ marginTop: 2 }}>
                    {ws.name}
                  </Tag>
                </div>
              </div>

              <Paragraph
                style={{ color: colors.textSecondary, fontSize: 13, flex: 1, margin: 0, lineHeight: 1.7 }}
                ellipsis={{ rows: 3 }}
              >
                {ws.description || '暂无描述'}
              </Paragraph>

              <Divider style={{ margin: '4px 0', borderColor: colors.borderSubtle }} />

              <Space wrap size={8}>
                <Button
                  size="small"
                  type="primary"
                  style={{ background: colors.primary, borderColor: colors.primary, borderRadius: 8 }}
                  onClick={() => navigate(`/w/${ws.name}`)}
                >
                  进入分析
                </Button>
                <Button
                  size="small"
                  icon={<ClusterOutlined />}
                  onClick={() => navigate(`/w/${ws.name}/graph`)}
                >
                  知识图谱
                </Button>
                <Button
                  size="small"
                  icon={<SettingOutlined />}
                  onClick={() => navigate(`/w/${ws.name}/setup`)}
                >
                  Pipeline 设置
                </Button>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </Section>
  );

  /* ── 6. Quick Start ──────────────────────────────────────────────── */
  const quickStart = (
    <Section bg={colors.bgMuted}>
      <SectionTitle sub="三步即可完成从数据接入到智能分析的全流程">快速开始</SectionTitle>
      <Row gutter={[24, 24]} justify="center">
        {[
          {
            step: 1,
            title: '创建工作空间',
            desc: '提供数据库连接地址（SQLite / PostgreSQL / MySQL），或直接上传 CSV / Excel 文件。系统将自动识别数据源类型。',
            icon: <PlusOutlined style={{ fontSize: 24, color: colors.primary }} />,
            action: { label: '立即创建', to: '/create' },
            iconBg: colors.primarySubtle,
          },
          {
            step: 2,
            title: '执行知识构建',
            desc: '在 Pipeline 设置页面依次执行 5 个构建阶段。语义标注阶段会自动生成中文别名，支持人工审核与修改后继续下一步。',
            icon: <SettingOutlined style={{ fontSize: 24, color: colors.purple }} />,
            action: null,
            iconBg: colors.bgPurpleSubtle,
          },
          {
            step: 3,
            title: '开始提问',
            desc: '在 Chat 界面用自然语言提问。AI 会自动选择「智能问数」或「多路归因」模式，流式返回分析过程与结论。',
            icon: <CheckCircleOutlined style={{ fontSize: 24, color: colors.emerald }} />,
            action: null,
            iconBg: colors.bgGreenSubtle,
          },
        ].map((item) => (
          <Col key={item.step} xs={24} md={8}>
            <Card
              className={`da-card-hover da-animate-in-${item.step}`}
              style={{
                borderRadius: 16,
                height: '100%',
                border: `1px solid ${colors.borderBase}`,
                background: colors.bgCard,
                boxShadow: colors.shadowCard,
              }}
              styles={{ body: { padding: 28, display: 'flex', flexDirection: 'column', gap: 16 } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: item.iconBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.icon}
                </div>
                <div>
                  <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: 600 }}>
                    STEP {item.step}
                  </Text>
                  <Title level={4} style={{ margin: 0, color: colors.textPrimary }}>
                    {item.title}
                  </Title>
                </div>
              </div>
              <Paragraph style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 1.8, margin: 0 }}>
                {item.desc}
              </Paragraph>
              {item.action && (
                <Button
                  type="primary"
                  style={{
                    background: colors.primary,
                    borderColor: colors.primary,
                    alignSelf: 'flex-start',
                    borderRadius: 8,
                  }}
                  icon={<ArrowRightOutlined />}
                  onClick={() => navigate(item.action!.to)}
                >
                  {item.action.label}
                </Button>
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </Section>
  );

  /* ── Footer ──────────────────────────────────────────────────────── */
  const footer = (
    <footer
      style={{
        background: mode === 'dark' ? '#050508' : '#1e1b4b',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <Text style={{ color: '#475569', fontSize: 13 }}>
        DataAgent 智能数据分析平台 · 内部工具
      </Text>
    </footer>
  );

  return (
    <div style={{ fontFamily: "'DM Sans', 'Noto Sans SC', -apple-system, sans-serif" }}>
      <HomeThemeToggle />
      {hero}
      {features}
      {architecture}
      {techStack}
      {workspaceSection}
      {quickStart}
      {footer}
    </div>
  );
};

export default Home;
