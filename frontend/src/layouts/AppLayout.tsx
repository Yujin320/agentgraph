import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, useParams } from 'react-router-dom';
import { Layout, Menu, Typography, Button, Drawer, Divider } from 'antd';
import {
  HomeOutlined,
  CompassOutlined,
  ApartmentOutlined,
  TableOutlined,
  SettingOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  ControlOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { useTheme } from '../contexts/ThemeContext';

const { Sider, Header, Content } = Layout;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

function buildMenuItems(ws: string) {
  return {
    analyst: [
      { key: `/w/${ws}`, icon: <CompassOutlined />, label: '归因探索' },
      { key: `/w/${ws}/graph`, icon: <ApartmentOutlined />, label: '知识体系' },
      { key: `/w/${ws}/data`, icon: <TableOutlined />, label: '数据探索' },
    ],
    admin: [
      { key: `/w/${ws}/setup`, icon: <ControlOutlined />, label: '知识构建' },
      { key: `/w/${ws}/governance`, icon: <DatabaseOutlined />, label: '数据治理' },
      { key: `/w/${ws}/logs`, icon: <ClockCircleOutlined />, label: '查询日志' },
      { key: `/w/${ws}/config`, icon: <SettingOutlined />, label: '系统配置' },
    ],
  };
}

/* ── Sun/Moon Toggle ─────────────────────────────────────────────────────── */
function ThemeToggle() {
  const { mode, toggleTheme } = useTheme();
  return (
    <button
      className="da-theme-toggle"
      onClick={toggleTheme}
      title={mode === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
      aria-label="Toggle theme"
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

/* ── Sidebar Menu ────────────────────────────────────────────────────────── */
function SidebarMenu({
  workspace,
  selectedKey,
  onSelect,
}: {
  workspace: string;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const { colors, mode } = useTheme();
  const items = buildMenuItems(workspace);
  const menuTheme = mode === 'dark' ? 'dark' : 'light';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Logo area */}
      <div style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: `1px solid ${colors.sidebarDivider}`,
        padding: '0 16px',
      }}>
        <Typography.Text strong style={{
          color: colors.primary,
          fontSize: 16,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontFamily: "'Instrument Serif', Georgia, serif",
          letterSpacing: '0.02em',
        }}>
          DataAgent
        </Typography.Text>
      </div>

      {/* Analyst section */}
      <div style={{ padding: '12px 0 0' }}>
        <Typography.Text style={{
          color: colors.textMuted,
          fontSize: 11,
          padding: '4px 24px',
          display: 'block',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
        }}>
          分析
        </Typography.Text>
        <Menu
          theme={menuTheme}
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items.analyst}
          onClick={({ key }) => onSelect(key)}
          style={{ borderRight: 'none', background: 'transparent' }}
        />
      </div>

      <Divider style={{ borderColor: colors.sidebarDivider, margin: '4px 16px', minWidth: 'auto', width: 'auto' }} />

      {/* Admin section */}
      <div>
        <Typography.Text style={{
          color: colors.textMuted,
          fontSize: 11,
          padding: '4px 24px',
          display: 'block',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
        }}>
          管理
        </Typography.Text>
        <Menu
          theme={menuTheme}
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items.admin}
          onClick={({ key }) => onSelect(key)}
          style={{ borderRight: 'none', background: 'transparent' }}
        />
      </div>
    </div>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspace = '' } = useParams<{ workspace: string }>();
  const { colors } = useTheme();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const currentPath = location.pathname;
  const allKeys = workspace
    ? [
        `/w/${workspace}`,
        `/w/${workspace}/graph`,
        `/w/${workspace}/data`,
        `/w/${workspace}/setup`,
        `/w/${workspace}/setup/schema`,
        `/v/${workspace}/governance`,
        `/w/${workspace}/governance`,
        `/w/${workspace}/logs`,
        `/w/${workspace}/config`,
      ]
    : [];

  const selectedKey =
    allKeys
      .filter((k) => k !== `/w/${workspace}`)
      .find((k) => currentPath.startsWith(k)) ?? `/w/${workspace}`;

  const handleMenuSelect = (key: string) => {
    navigate(key);
    setMobileDrawerOpen(false);
  };

  const sidebarContent = workspace ? (
    <SidebarMenu workspace={workspace} selectedKey={selectedKey} onSelect={handleMenuSelect} />
  ) : null;

  return (
    <Layout style={{ minHeight: '100vh', background: colors.bgBase }}>
      {/* Desktop sidebar — frosted glass */}
      {!isMobile && workspace && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={220}
          style={{
            overflow: 'auto',
            height: '100vh',
            position: 'sticky',
            top: 0,
            left: 0,
            background: colors.bgSidebar,
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRight: `1px solid ${colors.glassBorder}`,
          }}
        >
          {sidebarContent}
        </Sider>
      )}

      <Layout style={{ background: colors.bgBase }}>
        <Header style={{
          background: colors.glassBackground,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          padding: isMobile ? '0 12px' : '0 24px',
          display: 'flex',
          alignItems: 'center',
          borderBottom: `1px solid ${colors.glassBorder}`,
          height: 52,
          lineHeight: '52px',
          zIndex: 10,
          position: 'sticky',
          top: 0,
        }}>
          {/* Mobile hamburger */}
          {isMobile && workspace && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileDrawerOpen(true)}
              style={{ fontSize: 18, marginRight: 8, color: colors.textPrimary }}
            />
          )}

          {/* Home link */}
          <div
            onClick={() => navigate('/')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              marginRight: 16,
              userSelect: 'none',
            }}
          >
            <HomeOutlined style={{ fontSize: 16, color: colors.primary }} />
            {!isMobile && (
              <Typography.Text style={{ fontSize: 14, color: colors.textSecondary }}>
                首页
              </Typography.Text>
            )}
          </div>

          {/* Workspace name */}
          {workspace && (
            <Typography.Text strong style={{ fontSize: 15, color: colors.textPrimary }}>
              {workspace}
            </Typography.Text>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Theme toggle */}
          <ThemeToggle />
        </Header>

        {/* Mobile drawer nav */}
        {isMobile && workspace && (
          <Drawer
            placement="left"
            open={mobileDrawerOpen}
            onClose={() => setMobileDrawerOpen(false)}
            width={240}
            styles={{
              body: {
                padding: 0,
                background: colors.bgElevated,
              },
              header: { display: 'none' },
            }}
          >
            {sidebarContent}
          </Drawer>
        )}

        <Content
          className="da-page-enter"
          style={{
            padding: isMobile ? 8 : '12px 20px',
            background: colors.bgBase,
            overflow: 'auto',
            flex: 1,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
