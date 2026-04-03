import ReactECharts from 'echarts-for-react';
import { useTheme } from '../contexts/ThemeContext';

interface ChartSpec {
  type: string;
  x_col?: string;
  y_cols?: string[];
  columns?: string[];
  data: Record<string, unknown>[];
}

interface Props {
  spec: ChartSpec;
  height?: number;
}

export default function ChartRenderer({ spec, height }: Props) {
  const isMobile = window.innerWidth <= 768;
  const resolvedHeight = height ?? (isMobile ? 220 : 350);
  const { chartColors, colors, mode } = useTheme();
  const option = buildOption(spec, chartColors, colors.textSecondary, colors.borderSubtle, mode);
  if (!option) return null;
  const instanceKey = `chart-${spec.type}-${(spec.x_col ?? '')}-${mode}`;
  return (
    <div style={{ animation: 'da-fade-in 0.4s ease-out both' }}>
      <ReactECharts
        key={instanceKey}
        option={option}
        style={{ height: resolvedHeight }}
        opts={{ renderer: 'canvas' }}
        notMerge={true}
      />
    </div>
  );
}

function buildOption(
  spec: ChartSpec,
  chartColors: string[],
  textColor: string,
  borderColor: string,
  mode: string,
): Record<string, unknown> | null {
  const { type, data, columns = [] } = spec;
  if (!data || data.length === 0) return null;

  const xCol = spec.x_col ?? columns[0];
  const yCols =
    spec.y_cols && spec.y_cols.length > 0
      ? spec.y_cols
      : columns.filter((c) => c !== xCol);
  const xData = data.map((r) => r[xCol]);

  const axisStyle = {
    axisLine: { lineStyle: { color: borderColor } },
    axisLabel: { color: textColor, fontSize: 11 },
    splitLine: { lineStyle: { color: borderColor, type: 'dashed' as const } },
  };

  const baseOption = {
    color: chartColors,
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: mode === 'dark' ? 'rgba(17,24,39,0.95)' : 'rgba(255,255,255,0.95)',
      borderColor: borderColor,
      textStyle: { color: mode === 'dark' ? '#f1f5f9' : '#0f172a', fontSize: 12 },
    },
    grid: { left: 60, right: 20, top: 40, bottom: 40 },
    legend: yCols.length > 1 ? { data: yCols, top: 0, textStyle: { color: textColor } } : undefined,
  };

  if (type === 'bar' || type === 'bar_h') {
    return {
      ...baseOption,
      xAxis:
        type === 'bar_h'
          ? { type: 'value', ...axisStyle }
          : {
              type: 'category',
              data: xData,
              ...axisStyle,
              axisLabel: { ...axisStyle.axisLabel, rotate: xData.length > 6 ? 30 : 0 },
            },
      yAxis:
        type === 'bar_h'
          ? { type: 'category', data: xData, ...axisStyle }
          : { type: 'value', ...axisStyle },
      series: yCols.map((col) => ({
        name: col,
        type: 'bar',
        data: data.map((r) => r[col]),
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      })),
    };
  }

  if (type === 'line') {
    return {
      ...baseOption,
      xAxis: { type: 'category', data: xData, ...axisStyle },
      yAxis: { type: 'value', ...axisStyle },
      series: yCols.map((col) => ({
        name: col,
        type: 'line',
        data: data.map((r) => r[col]),
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        areaStyle: { opacity: 0.05 },
      })),
    };
  }

  if (type === 'pie') {
    const valCol = yCols[0] ?? columns[1];
    return {
      color: chartColors,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
        backgroundColor: mode === 'dark' ? 'rgba(17,24,39,0.95)' : 'rgba(255,255,255,0.95)',
        borderColor: borderColor,
        textStyle: { color: mode === 'dark' ? '#f1f5f9' : '#0f172a' },
      },
      series: [
        {
          type: 'pie',
          radius: ['35%', '65%'],
          data: data.map((r) => ({ name: r[xCol], value: r[valCol] })),
          label: { show: true, formatter: '{b}\n{d}%', color: textColor },
        },
      ],
    };
  }

  return null;
}
