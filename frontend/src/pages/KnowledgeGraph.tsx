import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
// @ts-ignore
import ForceGraph2D from 'react-force-graph-2d';
import { Button, Card, Spin, Alert, Typography, Tag, Space } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import api from '../api/client';

const { Title, Text } = Typography;

// ── Types ──────────────────────────────────────────────────────────────────

interface KGNode {
  id: string;
  label: string;
  type: string;
  table: string;
}

interface KGEdge {
  source: string;
  target: string;
  type: string;
}

interface KGData {
  nodes: KGNode[];
  edges: KGEdge[];
}

// ── Color/style config ──────────────────────────────────────────────────────

const colorByType: Record<string, string> = {
  Metric: '#1677ff',
  Dimension: '#52c41a',
  Table: '#fa8c16',
  Scenario: '#722ed1',
};

const legendItems = [
  { type: 'Metric', color: '#1677ff', label: '指标 (Metric)' },
  { type: 'Dimension', color: '#52c41a', label: '维度 (Dimension)' },
  { type: 'Table', color: '#fa8c16', label: '表 (Table)' },
  { type: 'Scenario', color: '#722ed1', label: '场景 (Scenario)' },
];

const edgeLegendItems = [
  { type: 'CAUSES', color: '#ff4d4f', dash: true, label: 'CAUSES (因果)' },
  { type: 'DRILLDOWN', color: '#1677ff', dash: false, label: 'DRILLDOWN (下钻)' },
  { type: 'BELONGS_TO', color: '#aaa', dash: false, thin: true, label: 'BELONGS_TO (归属)' },
  { type: 'ENTRY_POINT', color: '#722ed1', dash: false, label: 'ENTRY_POINT (入口)' },
];

function getLinkColor(type: string): string {
  if (type === 'CAUSES') return '#ff4d4f';
  if (type === 'DRILLDOWN') return '#1677ff';
  if (type === 'ENTRY_POINT') return '#722ed1';
  return '#ccc';
}

// ── KnowledgeGraph page ─────────────────────────────────────────────────────

const KnowledgeGraph: React.FC = () => {
  const { workspace = '' } = useParams<{ workspace: string }>();
  const navigate = useNavigate();

  const [graphData, setGraphData] = useState<{ nodes: KGNode[]; links: KGEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ node: KGNode; x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Measure container
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Fetch KG data
  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    api
      .get<KGData>(`/workspaces/${workspace}/kg`)
      .then((res) => {
        const { nodes, edges } = res.data;
        setGraphData({ nodes, links: edges });
        setLoading(false);
      })
      .catch((err) => {
        setError(err?.response?.data?.detail ?? err.message ?? '加载失败');
        setLoading(false);
      });
  }, [workspace]);

  const handleNodeHover = useCallback((node: KGNode | null, _prevNode: KGNode | null) => {
    setTooltip(node ? { node, x: 0, y: 0 } : null);
  }, []);

  // Track mouse position for tooltip
  const mousePos = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
      setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: 56,
          flexShrink: 0,
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/w/${workspace}`)}
        />
        <Title level={5} style={{ margin: 0, color: '#4f46e5' }}>
          知识图谱
        </Title>
        <Tag color="purple">{workspace}</Tag>
        <div style={{ flex: 1 }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          节点数: {graphData?.nodes.length ?? 0} / 边数: {graphData?.links.length ?? 0}
        </Text>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Graph canvas */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                background: 'rgba(245,245,245,0.8)',
              }}
            >
              <Spin size="large" tip="正在加载知识图谱..." />
            </div>
          )}

          {error && (
            <div style={{ padding: 32 }}>
              <Alert type="error" message="加载失败" description={error} showIcon />
            </div>
          )}

          {!loading && !error && graphData && (
            <ForceGraph2D
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              nodeColor={(node: KGNode) => colorByType[node.type] ?? '#999'}
              nodeLabel={(node: KGNode) => node.label}
              nodeRelSize={6}
              linkColor={(link: KGEdge) => getLinkColor(link.type)}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
              linkWidth={(link: KGEdge) => (link.type === 'BELONGS_TO' ? 1 : 2)}
              linkLineDash={(link: KGEdge) => (link.type === 'CAUSES' ? [4, 2] : null)}
              onNodeHover={handleNodeHover}
              nodeCanvasObject={(node: KGNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const label = node.label || node.id;
                const fontSize = Math.max(10 / globalScale, 3);
                const r = 6;
                const color = colorByType[node.type] ?? '#999';

                // Draw circle
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI, false);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5 / globalScale;
                ctx.stroke();

                // Draw label
                if (globalScale > 0.5) {
                  ctx.font = `${fontSize}px Sans-Serif`;
                  ctx.fillStyle = '#333';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'top';
                  ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + 2 / globalScale);
                }
              }}
              nodePointerAreaPaint={(node: KGNode & { x?: number; y?: number }, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, 8, 0, 2 * Math.PI, false);
                ctx.fill();
              }}
              backgroundColor="#f8f8fc"
            />
          )}

          {/* Hover tooltip */}
          {tooltip && tooltip.x > 0 && (
            <div
              style={{
                position: 'fixed',
                left: tooltip.x + 14,
                top: tooltip.y + 14,
                background: 'rgba(0,0,0,0.75)',
                color: '#fff',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                pointerEvents: 'none',
                zIndex: 9999,
                maxWidth: 220,
              }}
            >
              <div><strong>{tooltip.node.label}</strong></div>
              <div>ID: {tooltip.node.id}</div>
              <div>类型: {tooltip.node.type}</div>
              {tooltip.node.table && <div>表: {tooltip.node.table}</div>}
            </div>
          )}
        </div>

        {/* Right legend panel */}
        <Card
          size="small"
          title="图例"
          style={{
            width: 200,
            flexShrink: 0,
            borderLeft: '1px solid #f0f0f0',
            borderRadius: 0,
            overflowY: 'auto',
          }}
          bodyStyle={{ padding: '12px 16px' }}
        >
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
            节点类型
          </Text>
          <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 16 }}>
            {legendItems.map((item) => (
              <div key={item.type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: item.color,
                    flexShrink: 0,
                  }}
                />
                <Text style={{ fontSize: 12 }}>{item.label}</Text>
              </div>
            ))}
          </Space>

          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
            边类型
          </Text>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {edgeLegendItems.map((item) => (
              <div key={item.type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="24" height="10">
                  <line
                    x1="0"
                    y1="5"
                    x2="24"
                    y2="5"
                    stroke={item.color}
                    strokeWidth={item.thin ? 1 : 2}
                    strokeDasharray={item.dash ? '4,2' : undefined}
                  />
                </svg>
                <Text style={{ fontSize: 11 }}>{item.label}</Text>
              </div>
            ))}
          </Space>
        </Card>
      </div>
    </div>
  );
};

export default KnowledgeGraph;
