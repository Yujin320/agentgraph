import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Row, Col, Descriptions, Button, Typography, Spin, Empty,
  Tag, Steps, Table, Switch, Divider, Statistic,
} from 'antd';
import {
  ApartmentOutlined, NodeIndexOutlined, TagsOutlined,
  ShareAltOutlined, ZoomInOutlined, RightOutlined, BulbOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import api from '../api/client';
import { useTheme } from '../contexts/ThemeContext';

const { Text, Title } = Typography;

// ──────────────────────────────────────────────────────────────────────────────
// Layer configuration — maps table names → business layer names
// ──────────────────────────────────────────────────────────────────────────────

const TABLE_LAYER_MAP: Record<string, string> = {
  supplier_performance: '供应层',
  production_output: '生产层',
  production_downtime: '生产层',
  inventory_stock: '库存层',
  sales_delivery: '销售层',
  sales_order: '销售层',
  rolling_plan: '计划层',
  customer_complaint: '客户层',
  overtime_hours: '生产层',
  external_procurement: '供应层',
};

const LAYER_ORDER = ['供应层', '生产层', '库存层', '计划层', '销售层', '客户层', '其他'];

const LAYER_COLORS: Record<string, string> = {
  '供应层': '#6366F1',
  '生产层': '#0EA5E9',
  '库存层': '#10B981',
  '计划层': '#8B5CF6',
  '销售层': '#F59E0B',
  '客户层': '#EF4444',
  '其他': '#94A3B8',
};

const LAYER_BAND_COLORS: Record<string, string> = {
  '供应层': 'rgba(99,102,241,0.08)',
  '生产层': 'rgba(14,165,233,0.08)',
  '库存层': 'rgba(16,185,129,0.08)',
  '计划层': 'rgba(139,92,246,0.08)',
  '销售层': 'rgba(245,158,11,0.08)',
  '客户层': 'rgba(239,68,68,0.08)',
  '其他': 'rgba(148,163,184,0.05)',
};

// Horizontal x position for each layer band (DAG layout left→right)
const LAYER_X: Record<string, number> = {
  '供应层': 120,
  '生产层': 340,
  '库存层': 560,
  '计划层': 560,
  '销售层': 780,
  '客户层': 1000,
  '其他': 1220,
};

const LAYER_BAND_HALF_W = 95;

// ──────────────────────────────────────────────────────────────────────────────
// API types — v2 graph returns flat nodes/edges from Neo4j
// ──────────────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string;
  node_type: string; // 'Metric' | 'Dimension' | 'Table' | ...
  table?: string;
  description?: string;
  unit?: string;
  formula?: string;
  [key: string]: unknown;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string; // 'CAUSES' | 'DRILLDOWN' | 'BELONGS_TO' | ...
  label?: string;
}

interface ScenarioInfo {
  id: string;
  name: string;
  entry_metric?: string;
  description?: string;
}

interface GraphStats {
  total_nodes?: number;
  total_edges?: number;
  metric_count?: number;
  dimension_count?: number;
  [key: string]: unknown;
}

interface V2GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  scenarios?: ScenarioInfo[];
  causal_edges?: GraphEdge[];
  stats?: GraphStats;
}

// ──────────────────────────────────────────────────────────────────────────────
// Derived types after processing
// ──────────────────────────────────────────────────────────────────────────────

interface LayerGroup {
  name: string;
  nodes: GraphNode[];
}

interface CausalChain {
  id: string;
  name: string;
  path: string[];  // node ids
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function getNodeLayer(node: GraphNode): string {
  if (node.table && TABLE_LAYER_MAP[node.table]) return TABLE_LAYER_MAP[node.table];
  // Heuristic from node name or id
  if (/供应|supplier/i.test(node.name)) return '供应层';
  if (/生产|produc|overtime/i.test(node.name)) return '生产层';
  if (/库存|inventory/i.test(node.name)) return '库存层';
  if (/计划|plan/i.test(node.name)) return '计划层';
  if (/销售|sales|delivery|order/i.test(node.name)) return '销售层';
  if (/客户|customer|complaint/i.test(node.name)) return '客户层';
  return '其他';
}

/** Build layer groups from a list of Metric nodes */
function buildLayerGroups(nodes: GraphNode[]): LayerGroup[] {
  const grouped: Record<string, GraphNode[]> = {};
  for (const n of nodes) {
    const layer = getNodeLayer(n);
    if (!grouped[layer]) grouped[layer] = [];
    grouped[layer].push(n);
  }
  // Order by LAYER_ORDER
  return LAYER_ORDER
    .filter((l) => grouped[l] && grouped[l].length > 0)
    .map((l) => ({ name: l, nodes: grouped[l] }));
}

/** Build causal chains from CAUSES edges (simple DFS from root nodes) */
function deriveCausalChains(
  nodes: GraphNode[],
  edges: GraphEdge[],
): CausalChain[] {
  const causesEdges = edges.filter((e) => e.type === 'CAUSES');
  if (causesEdges.length === 0) return [];

  // Build adjacency
  const adj: Record<string, string[]> = {};
  const inDeg: Record<string, number> = {};
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const e of causesEdges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
    inDeg[e.target] = (inDeg[e.target] ?? 0) + 1;
  }

  // Roots: nodes with no incoming CAUSES edges
  const roots = nodes
    .filter((n) => !inDeg[n.id])
    .filter((n) => adj[n.id]?.length > 0);

  const chains: CausalChain[] = [];

  const dfs = (id: string, path: string[], visited: Set<string>) => {
    path.push(id);
    visited.add(id);
    const children = (adj[id] ?? []).filter((c) => !visited.has(c));
    if (children.length === 0) {
      if (path.length >= 2) {
        const start = nodes.find((n) => n.id === path[0])?.name ?? path[0];
        const end = nodes.find((n) => n.id === path[path.length - 1])?.name ?? path[path.length - 1];
        chains.push({
          id: `chain_${chains.length + 1}`,
          name: `${start} → ${end}`,
          path: [...path],
        });
      }
    } else {
      for (const c of children) {
        dfs(c, path, new Set(visited));
      }
    }
  };

  for (const root of roots.slice(0, 10)) {
    dfs(root.id, [], new Set());
  }

  // Deduplicate and limit
  return chains.slice(0, 15);
}

// ──────────────────────────────────────────────────────────────────────────────
// ECharts option builder for DAG view
// ──────────────────────────────────────────────────────────────────────────────

function buildDagOption(
  metricNodes: GraphNode[],
  edges: GraphEdge[],
  layerGroups: LayerGroup[],
  highlightChain: CausalChain | null,
  showDetail: boolean,
  allNodes: GraphNode[],
) {
  const highlightSet = new Set<string>(highlightChain?.path ?? []);
  const highlightEdges = new Set<string>();
  if (highlightChain) {
    for (let i = 0; i < highlightChain.path.length - 1; i++) {
      highlightEdges.add(`${highlightChain.path[i]}→${highlightChain.path[i + 1]}`);
    }
  }

  const canvasTop = 40;
  const canvasBottom = 600;
  const bandH = canvasBottom - canvasTop + 40;

  // Background band graphics
  const graphicElements: object[] = [];
  layerGroups.forEach((lg) => {
    const x = LAYER_X[lg.name] ?? 120;
    const bandColor = LAYER_BAND_COLORS[lg.name] ?? 'rgba(0,0,0,0.03)';
    const layerColor = LAYER_COLORS[lg.name] ?? '#999';

    graphicElements.push({
      type: 'rect',
      z: 0,
      shape: {
        x: x - LAYER_BAND_HALF_W,
        y: canvasTop - 10,
        width: LAYER_BAND_HALF_W * 2,
        height: bandH,
        r: 8,
      },
      style: {
        fill: bandColor,
        stroke: layerColor,
        lineWidth: 1,
        opacity: 0.9,
        lineDash: [4, 3],
      },
    });

    graphicElements.push({
      type: 'text',
      z: 1,
      style: {
        text: lg.name,
        x,
        y: canvasTop - 8,
        textAlign: 'center',
        textVerticalAlign: 'bottom',
        fill: layerColor,
        font: 'bold 13px "DM Sans","PingFang SC","Microsoft YaHei",sans-serif',
        opacity: 0.9,
      },
    });
  });

  // Build node id → position map
  const nodePositions: Record<string, { x: number; y: number }> = {};
  layerGroups.forEach((lg) => {
    const count = lg.nodes.length;
    const x = LAYER_X[lg.name] ?? 120;
    lg.nodes.forEach((node, i) => {
      const y =
        count === 1
          ? (canvasTop + canvasBottom) / 2
          : canvasTop + i * ((canvasBottom - canvasTop) / Math.max(count - 1, 1));
      nodePositions[node.id] = { x, y };
    });
  });

  // Extra nodes (Dimension, Table) if detail view is on
  const extraNodes: GraphNode[] = showDetail
    ? allNodes.filter((n) => n.node_type !== 'Metric')
    : [];

  // Position extra nodes to the far right
  extraNodes.forEach((n, i) => {
    nodePositions[n.id] = { x: 1400, y: 60 + i * 50 };
  });

  // Build ECharts nodes
  const eNodes: object[] = [];

  const renderNode = (node: GraphNode) => {
    const pos = nodePositions[node.id];
    if (!pos) return;
    const layerName = getNodeLayer(node);
    const layerColor = LAYER_COLORS[layerName] ?? '#94A3B8';
    const isHighlighted = highlightSet.has(node.id);
    const dimmed = highlightChain !== null && !isHighlighted;
    const isExtra = node.node_type !== 'Metric';

    eNodes.push({
      id: node.id,
      name: node.name,
      x: pos.x,
      y: pos.y,
      symbolSize: isExtra ? 28 : 50,
      symbol: isExtra ? 'rect' : 'circle',
      itemStyle: {
        color: dimmed ? '#333' : isExtra ? '#1e293b' : layerColor,
        opacity: dimmed ? 0.3 : 1,
        borderColor: isHighlighted ? '#F97316' : isExtra ? '#475569' : 'rgba(255,255,255,0.3)',
        borderWidth: isHighlighted ? 3 : 2,
        shadowColor: isHighlighted ? 'rgba(249,115,22,0.5)' : 'rgba(0,0,0,0.12)',
        shadowBlur: isHighlighted ? 14 : 5,
      },
      label: {
        show: true,
        fontSize: isExtra ? 9 : 11,
        fontWeight: isHighlighted ? 700 : 500,
        color: dimmed ? '#555' : isExtra ? '#94a3b8' : '#e2e8f0',
        position: 'bottom',
        distance: 6,
        overflow: 'break',
        width: 90,
      },
      _nodeData: node,
    });
  };

  metricNodes.forEach(renderNode);
  extraNodes.forEach(renderNode);

  // Build edges
  const relevantEdgeTypes = showDetail
    ? ['CAUSES', 'DRILLDOWN', 'BELONGS_TO']
    : ['CAUSES', 'DRILLDOWN'];

  const eLinks: object[] = edges
    .filter((e) => relevantEdgeTypes.includes(e.type))
    .filter((e) => nodePositions[e.source] && nodePositions[e.target])
    .map((edge) => {
      const key = `${edge.source}→${edge.target}`;
      const isHighlighted = highlightEdges.has(key);
      const dimmed = highlightChain !== null && !isHighlighted;
      const isCausal = edge.type === 'CAUSES';
      return {
        source: edge.source,
        target: edge.target,
        label: {
          show: !!edge.label && isHighlighted,
          formatter: edge.label ?? '',
          fontSize: 10,
          color: isCausal ? '#EA580C' : '#888',
          backgroundColor: 'rgba(15,18,25,0.7)',
          padding: [2, 4],
          borderRadius: 2,
          opacity: dimmed ? 0.2 : 1,
        },
        lineStyle: {
          color: isCausal
            ? isHighlighted ? '#F97316' : '#EF4444'
            : isHighlighted ? '#4f46e5' : '#94A3B8',
          width: isHighlighted ? 2.5 : isCausal ? 1.5 : 1,
          type: dimmed ? 'dotted' : 'solid',
          opacity: dimmed ? 0.15 : isCausal ? 0.7 : 0.45,
          curveness: 0.2,
        },
      };
    });

  return {
    backgroundColor: '#0f1219',
    tooltip: {
      backgroundColor: 'rgba(15,18,25,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (p: {
        dataType: string;
        data: { name?: string; _nodeData?: GraphNode };
      }) => {
        if (p.dataType === 'node' && p.data._nodeData) {
          const n = p.data._nodeData;
          const layer = getNodeLayer(n);
          const layerColor = LAYER_COLORS[layer] ?? '#999';
          const desc = n.description ? `<br/><span style="color:#94a3b8;font-size:11px">${n.description}</span>` : '';
          const unit = n.unit ? ` (${n.unit})` : '';
          return `<b style="color:#f1f5f9">${n.name}${unit}</b><br/><span style="color:${layerColor};font-size:11px">● ${layer}</span>${desc}`;
        }
        if (p.dataType === 'edge') {
          return (p.data as { label?: string }).label ?? '';
        }
        return '';
      },
    },
    graphic: { elements: graphicElements },
    series: [
      {
        type: 'graph',
        layout: 'none',
        roam: true,
        zoom: 0.8,
        center: ['50%', '50%'],
        data: eNodes,
        links: eLinks,
        symbol: 'circle',
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 8],
        label: { show: true },
        emphasis: {
          focus: 'adjacency',
          itemStyle: {
            shadowBlur: 20,
            shadowColor: 'rgba(0,0,0,0.25)',
          },
        },
      },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// ChainPathPanel — shows a single causal chain as a steps timeline
// ──────────────────────────────────────────────────────────────────────────────

function ChainPathPanel({
  chain,
  nodeMap,
}: {
  chain: CausalChain;
  nodeMap: Record<string, GraphNode>;
}) {
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <NodeIndexOutlined style={{ color: '#F97316', fontSize: 16 }} />
        <Text strong style={{ fontSize: 14 }}>{chain.name}</Text>
        <Tag color="orange" style={{ fontSize: 11 }}>{chain.path.length} 节点</Tag>
      </div>
      <Steps
        size="small"
        direction="horizontal"
        current={chain.path.length - 1}
        labelPlacement="vertical"
        style={{ overflowX: 'auto' }}
        items={chain.path.map((nodeId, idx) => {
          const node = nodeMap[nodeId];
          const layerName = node ? getNodeLayer(node) : '其他';
          const color = LAYER_COLORS[layerName] ?? '#1677ff';
          return {
            title: (
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    display: 'inline-block',
                    background: color,
                    color: '#fff',
                    borderRadius: 6,
                    padding: '3px 10px',
                    fontWeight: idx === 0 || idx === chain.path.length - 1 ? 700 : 500,
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                  }}
                >
                  {node?.name ?? nodeId}
                </div>
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{layerName}</div>
              </div>
            ),
            status: 'process' as const,
            icon: (
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: color,
                  opacity: 0.7,
                }}
              />
            ),
          };
        })}
      />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Node detail panel
// ──────────────────────────────────────────────────────────────────────────────

function NodeDetailPanel({
  node,
  edges,
  nodeMap,
  workspace,
  onClose,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  nodeMap: Record<string, GraphNode>;
  workspace: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { colors } = useTheme();
  const layerName = getNodeLayer(node);
  const layerColor = LAYER_COLORS[layerName] ?? '#1677ff';

  // Drill-down data
  const [drillResult, setDrillResult] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillDim, setDrillDim] = useState<string | null>(null);

  const upstream = edges
    .filter((e) => e.type === 'CAUSES' && e.target === node.id)
    .map((e) => e.source);
  const downstream = edges
    .filter((e) => e.type === 'CAUSES' && e.source === node.id)
    .map((e) => e.target);

  const drillDims = edges
    .filter((e) => e.type === 'DRILLDOWN' && e.source === node.id)
    .map((e) => ({ id: e.target, label: nodeMap[e.target]?.name ?? e.target }));

  const handleDrill = (dimId: string) => {
    setDrillLoading(true);
    setDrillDim(dimId);
    api
      .get(`/graph/${workspace}/drilldown`, { params: { node: node.id, dimension: dimId } })
      .then((res) => setDrillResult(res.data))
      .catch(() => setDrillResult(null))
      .finally(() => setDrillLoading(false));
  };

  const attrEntries = Object.entries(node).filter(
    ([k]) => !['id', 'name', 'node_type', 'table', 'description'].includes(k),
  );

  return (
    <Card
      title={
        <span style={{ color: layerColor }}>{node.name}</span>
      }
      extra={
        <Button size="small" type="text" onClick={onClose}>
          关闭
        </Button>
      }
      style={{ height: '100%', overflow: 'auto' }}
    >
      <Tag style={{ color: layerColor, borderColor: layerColor, background: `${layerColor}18` }}>
        {layerName}
      </Tag>
      <Tag color="default" style={{ marginLeft: 4 }}>
        {node.node_type}
      </Tag>

      <Descriptions column={1} size="small" style={{ marginTop: 12 }}>
        {node.description && (
          <Descriptions.Item label="描述">{node.description}</Descriptions.Item>
        )}
        {node.table && (
          <Descriptions.Item label="来源表">
            <Text code style={{ fontSize: 11 }}>{node.table}</Text>
          </Descriptions.Item>
        )}
        {node.unit && (
          <Descriptions.Item label="单位">{String(node.unit)}</Descriptions.Item>
        )}
        {node.formula && (
          <Descriptions.Item label="计算公式">
            <Text code style={{ fontSize: 11 }}>{String(node.formula)}</Text>
          </Descriptions.Item>
        )}
        {attrEntries
          .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
          .slice(0, 4)
          .map(([k, v]) => (
            <Descriptions.Item key={k} label={k}>{String(v)}</Descriptions.Item>
          ))}
        {upstream.length > 0 && (
          <Descriptions.Item label="上游因素">
            {upstream.map((id) => (
              <Tag key={id} style={{ marginBottom: 2 }}>
                {nodeMap[id]?.name ?? id}
              </Tag>
            ))}
          </Descriptions.Item>
        )}
        {downstream.length > 0 && (
          <Descriptions.Item label="下游影响">
            {downstream.map((id) => (
              <Tag key={id} style={{ marginBottom: 2 }}>
                {nodeMap[id]?.name ?? id}
              </Tag>
            ))}
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* Drill-down dimensions */}
      {drillDims.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong style={{ fontSize: 13 }}>
            <ZoomInOutlined /> 维度下钻
          </Text>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {drillDims.map((d) => (
              <Button
                key={d.id}
                size="small"
                type={drillDim === d.id ? 'primary' : 'default'}
                loading={drillLoading && drillDim === d.id}
                onClick={() => handleDrill(d.id)}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {drillResult && (
        <Table
          size="small"
          style={{ marginTop: 12 }}
          dataSource={drillResult.rows.map((r, i) => {
            const obj: Record<string, unknown> = { _key: i };
            drillResult.columns.forEach((col, ci) => {
              obj[col] = (r as unknown[])[ci];
            });
            return obj;
          })}
          rowKey="_key"
          columns={drillResult.columns.map((col) => ({
            title: col,
            dataIndex: col,
            key: col,
            ellipsis: true,
          }))}
          pagination={{ pageSize: 8, size: 'small' }}
          scroll={{ x: 'max-content' }}
        />
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <Button
          type="primary"
          icon={<RightOutlined />}
          onClick={() => navigate(`/w/${workspace}/attribution`)}
          block
          style={{ background: colors.primary, borderColor: colors.primary }}
        >
          归因分析
        </Button>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────────

export default function CausalGraph() {
  const { workspace = '' } = useParams<{ workspace: string }>();
  const { colors, mode } = useTheme();

  const [rawData, setRawData] = useState<V2GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View toggles
  const [showDetail, setShowDetail] = useState(false);
  const [highlightChainId, setHighlightChainId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Load graph data
  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    api
      .get(`/graph/${workspace}`)
      .then((res) => {
        setRawData(res.data);
        setLoading(false);
      })
      .catch((err: { response?: { data?: { detail?: string } } }) => {
        setError(err?.response?.data?.detail ?? '图谱数据加载失败');
        setLoading(false);
      });
  }, [workspace]);

  // Derived data
  const { metricNodes, allNodes, edges, layerGroups, causalChains, nodeMap, stats } =
    useMemo(() => {
      if (!rawData) {
        return {
          metricNodes: [] as GraphNode[],
          allNodes: [] as GraphNode[],
          edges: [] as GraphEdge[],
          layerGroups: [] as LayerGroup[],
          causalChains: [] as CausalChain[],
          nodeMap: {} as Record<string, GraphNode>,
          stats: null as GraphStats | null,
        };
      }

      const allNodes = rawData.nodes ?? [];
      const metricNodes = allNodes.filter((n) => n.node_type === 'Metric' || !n.node_type);
      const edges = [
        ...(rawData.edges ?? []),
        ...(rawData.causal_edges ?? []),
      ];

      const layerGroups = buildLayerGroups(metricNodes);
      const causalChains = deriveCausalChains(metricNodes, edges);

      const nodeMap: Record<string, GraphNode> = {};
      for (const n of allNodes) nodeMap[n.id] = n;

      return {
        metricNodes,
        allNodes,
        edges,
        layerGroups,
        causalChains,
        nodeMap,
        stats: rawData.stats ?? null,
      };
    }, [rawData]);

  const highlightChain = causalChains.find((c) => c.id === highlightChainId) ?? null;

  const dagOption = useMemo(() => {
    if (metricNodes.length === 0) return null;
    return buildDagOption(metricNodes, edges, layerGroups, highlightChain, showDetail, allNodes);
  }, [metricNodes, edges, layerGroups, highlightChain, showDetail, allNodes]);

  const handleChartClick = useCallback(
    (params: { dataType?: string; data?: { _nodeData?: GraphNode } }) => {
      if (params.dataType === 'node' && params.data?._nodeData) {
        setSelectedNode(params.data._nodeData);
        setHighlightChainId(null);
      }
    },
    [],
  );

  const scenarios = rawData?.scenarios ?? [];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" tip="加载因果图谱…" />
      </div>
    );
  }

  if (error) {
    return <Empty description={error} style={{ marginTop: 80 }} />;
  }

  if (!rawData || metricNodes.length === 0) {
    return (
      <Empty
        description="暂无图谱数据，请先运行数据管道完成知识图谱构建"
        style={{ marginTop: 80 }}
      />
    );
  }

  const hasPanel = selectedNode !== null;

  return (
    <div style={{ padding: '0 0 24px 0' }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ marginBottom: 4 }}>
          <ApartmentOutlined style={{ marginRight: 8, color: colors.primary }} />
          因果图谱
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          工作空间 {workspace} · 基于 Neo4j 知识图谱构建的指标因果关系 DAG
        </Text>
      </div>

      {/* Stats bar */}
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {[
            { label: '总节点', value: stats.total_nodes ?? metricNodes.length },
            { label: '指标节点', value: stats.metric_count ?? metricNodes.length },
            { label: '维度节点', value: stats.dimension_count ?? allNodes.filter((n) => n.node_type === 'Dimension').length },
            { label: '因果边', value: edges.filter((e) => e.type === 'CAUSES').length },
          ].map((s) => (
            <Col xs={12} sm={6} key={s.label}>
              <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
                <Statistic title={s.label} value={s.value as number} valueStyle={{ fontSize: 20 }} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* Controls */}
      <Card
        size="small"
        style={{ marginBottom: 12, borderColor: colors.borderBase, background: colors.bgMuted }}
        styles={{ body: { padding: '10px 16px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Text strong style={{ fontSize: 12, color: '#64748B' }}>视图选项：</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch
              size="small"
              checked={showDetail}
              onChange={setShowDetail}
            />
            <Text style={{ fontSize: 12 }}>详细视图（含维度/表节点）</Text>
          </div>

          <Divider type="vertical" />

          <Text strong style={{ fontSize: 12, color: '#64748B' }}>图层：</Text>
          {layerGroups.map((lg) => (
            <div key={lg.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: LAYER_COLORS[lg.name] ?? '#999',
                  flexShrink: 0,
                }}
              />
              <Text style={{ fontSize: 11, color: LAYER_COLORS[lg.name] ?? '#999', fontWeight: 600 }}>
                {lg.name}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>({lg.nodes.length})</Text>
            </div>
          ))}

          {highlightChainId && (
            <>
              <Divider type="vertical" />
              <Button
                size="small"
                type="link"
                onClick={() => setHighlightChainId(null)}
                style={{ padding: '0 4px', color: '#F97316' }}
              >
                清除高亮
              </Button>
            </>
          )}
        </div>
      </Card>

      <Row gutter={16}>
        {/* Left sidebar */}
        <Col xs={24} md={6} style={{ marginBottom: 16 }}>
          {/* Scenario list */}
          {scenarios.length > 0 && (
            <Card
              size="small"
              title={<><BulbOutlined style={{ marginRight: 4, color: colors.primary }} /> 分析场景</>}
              style={{ marginBottom: 12, borderColor: colors.borderBase }}
              styles={{ body: { padding: '8px 12px' } }}
            >
              {scenarios.map((s) => (
                <div
                  key={s.id}
                  style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 6, background: colors.bgMuted }}
                >
                  <Text strong style={{ fontSize: 12 }}>{s.name}</Text>
                  {s.entry_metric && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        入口指标：{s.entry_metric}
                      </Text>
                    </div>
                  )}
                  {s.description && (
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      {s.description}
                    </Text>
                  )}
                </div>
              ))}
            </Card>
          )}

          {/* Causal chain list */}
          {causalChains.length > 0 && (
            <Card
              size="small"
              title={<><ShareAltOutlined style={{ marginRight: 4, color: '#F97316' }} /> 因果链路</>}
              style={{ borderColor: colors.borderBase }}
              styles={{ body: { padding: '8px 12px' } }}
            >
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                点击高亮对应路径
              </Text>
              {causalChains.map((chain) => (
                <div
                  key={chain.id}
                  onClick={() =>
                    setHighlightChainId(highlightChainId === chain.id ? null : chain.id)
                  }
                  style={{
                    marginBottom: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: `1px solid ${highlightChainId === chain.id ? '#F97316' : colors.borderBase}`,
                    background: highlightChainId === chain.id ? (mode === 'dark' ? 'rgba(249,115,22,0.1)' : '#FFF7ED') : colors.bgMuted,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: highlightChainId === chain.id ? '#EA580C' : '#334155',
                      fontWeight: highlightChainId === chain.id ? 600 : 400,
                    }}
                  >
                    {chain.name}
                  </Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {chain.path.length} 个节点
                    </Text>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </Col>

        {/* Center: DAG chart */}
        <Col xs={24} md={hasPanel ? 12 : 18}>
          <Card
            title={
              <>
                <ApartmentOutlined style={{ color: colors.primary, marginRight: 6 }} />
                因果关系 DAG
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 8, fontWeight: 400 }}>
                  红色边 = CAUSES · 蓝色边 = DRILLDOWN
                </Text>
              </>
            }
            style={{ borderColor: colors.borderBase }}
            styles={{ body: { padding: 0, background: '#0f1219' } }}
          >
            {dagOption ? (
              <ReactECharts
                option={dagOption}
                style={{
                  height: 'min(calc(100vh - 320px), 660px)',
                  minHeight: 400,
                  background: '#0f1219',
                }}
                onEvents={{ click: handleChartClick }}
                notMerge={true}
              />
            ) : (
              <Empty description="无图谱数据" style={{ padding: 40 }} />
            )}
          </Card>

          {/* Chain path display */}
          {highlightChain && (
            <div style={{ marginTop: 12 }}>
              <ChainPathPanel chain={highlightChain} nodeMap={nodeMap} />
            </div>
          )}
        </Col>

        {/* Right: node detail panel */}
        {hasPanel && selectedNode && (
          <Col xs={24} md={6}>
            <NodeDetailPanel
              node={selectedNode}
              edges={edges}
              nodeMap={nodeMap}
              workspace={workspace}
              onClose={() => setSelectedNode(null)}
            />
          </Col>
        )}
      </Row>

      {/* Causal chains info panel (when no node selected) */}
      {!hasPanel && causalChains.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Text strong style={{ fontSize: 14 }}>
            <TagsOutlined style={{ marginRight: 6 }} />
            完整因果链路列表
          </Text>
          <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
            {causalChains.slice(0, 6).map((chain) => (
              <ChainPathPanel key={chain.id} chain={chain} nodeMap={nodeMap} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
