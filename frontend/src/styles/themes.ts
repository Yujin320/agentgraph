import type { ThemeConfig } from 'antd';
import { theme as antdTheme } from 'antd';

// ── Theme color tokens ──────────────────────────────────────────────────────

export interface ThemeColors {
  // Backgrounds
  bgBase: string;
  bgElevated: string;
  bgCard: string;
  bgCardHover: string;
  bgSidebar: string;
  bgInput: string;
  bgCode: string;
  bgMuted: string;
  bgAccentSubtle: string;
  bgPurpleSubtle: string;
  bgGreenSubtle: string;

  // Borders
  borderBase: string;
  borderSubtle: string;
  borderActive: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Brand colors
  primary: string;
  primaryHover: string;
  primarySubtle: string;
  accent: string;
  emerald: string;
  purple: string;

  // Semantic
  danger: string;
  warning: string;
  success: string;
  info: string;

  // Shadows
  shadowCard: string;
  shadowElevated: string;

  // Specific
  heroGradient: string;
  sidebarText: string;
  sidebarDivider: string;
  codeText: string;

  // Glass
  glassBackground: string;
  glassBorder: string;
}

export const lightColors: ThemeColors = {
  bgBase: '#fafaf8',
  bgElevated: '#ffffff',
  bgCard: '#ffffff',
  bgCardHover: '#fefefe',
  bgSidebar: 'rgba(255,255,255,0.72)',
  bgInput: '#f8f8f6',
  bgCode: '#0f172a',
  bgMuted: '#f5f5f3',
  bgAccentSubtle: '#eef2ff',
  bgPurpleSubtle: '#f5f3ff',
  bgGreenSubtle: '#ecfdf5',

  borderBase: '#e2e0dc',
  borderSubtle: '#f0eeea',
  borderActive: '#4338ca',

  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textInverse: '#ffffff',

  primary: '#4338ca',
  primaryHover: '#3730a3',
  primarySubtle: '#eef2ff',
  accent: '#d97706',
  emerald: '#059669',
  purple: '#7c3aed',

  danger: '#dc2626',
  warning: '#d97706',
  success: '#059669',
  info: '#4338ca',

  shadowCard: '0 2px 8px rgba(0,0,0,0.06), 0 0 1px rgba(0,0,0,0.08)',
  shadowElevated: '0 8px 30px rgba(0,0,0,0.10), 0 0 1px rgba(0,0,0,0.08)',

  heroGradient: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #3730a3 100%)',
  sidebarText: '#0f172a',
  sidebarDivider: 'rgba(0,0,0,0.06)',
  codeText: '#e2e8f0',

  glassBackground: 'rgba(255,255,255,0.72)',
  glassBorder: 'rgba(0,0,0,0.06)',
};

export const darkColors: ThemeColors = {
  bgBase: '#0a0a0f',
  bgElevated: '#111827',
  bgCard: 'rgba(255,255,255,0.04)',
  bgCardHover: 'rgba(255,255,255,0.06)',
  bgSidebar: 'rgba(17,24,39,0.85)',
  bgInput: 'rgba(255,255,255,0.06)',
  bgCode: '#0c0c14',
  bgMuted: 'rgba(255,255,255,0.04)',
  bgAccentSubtle: 'rgba(99,102,241,0.12)',
  bgPurpleSubtle: 'rgba(139,92,246,0.12)',
  bgGreenSubtle: 'rgba(16,185,129,0.12)',

  borderBase: 'rgba(255,255,255,0.08)',
  borderSubtle: 'rgba(255,255,255,0.04)',
  borderActive: '#6366f1',

  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textInverse: '#0f172a',

  primary: '#6366f1',
  primaryHover: '#818cf8',
  primarySubtle: 'rgba(99,102,241,0.15)',
  accent: '#f59e0b',
  emerald: '#10b981',
  purple: '#8b5cf6',

  danger: '#ef4444',
  warning: '#f59e0b',
  success: '#10b981',
  info: '#6366f1',

  shadowCard: '0 2px 8px rgba(0,0,0,0.25), 0 0 1px rgba(255,255,255,0.05)',
  shadowElevated: '0 8px 30px rgba(0,0,0,0.4), 0 0 1px rgba(255,255,255,0.06)',

  heroGradient: 'linear-gradient(135deg, #0a0a0f 0%, #1e1b4b 50%, #312e81 100%)',
  sidebarText: '#f1f5f9',
  sidebarDivider: 'rgba(255,255,255,0.06)',
  codeText: '#e2e8f0',

  glassBackground: 'rgba(17,24,39,0.85)',
  glassBorder: 'rgba(255,255,255,0.06)',
};

// ── AntDesign theme configs ─────────────────────────────────────────────────

const FONT_FAMILY = "'Plus Jakarta Sans', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const lightAntdTheme: ThemeConfig = {
  token: {
    colorPrimary: '#4338ca',
    colorSuccess: '#059669',
    colorWarning: '#d97706',
    colorError: '#dc2626',
    borderRadius: 10,
    fontFamily: FONT_FAMILY,
    colorBgLayout: '#fafaf8',
    colorBgContainer: '#ffffff',
    colorText: '#0f172a',
    colorTextSecondary: '#475569',
    colorBorder: '#e2e0dc',
    colorBorderSecondary: '#f0eeea',
    controlHeight: 38,
    fontWeightStrong: 700,
    fontSize: 14,
  },
  components: {
    Layout: {
      siderBg: 'transparent',
      headerBg: 'rgba(255,255,255,0.8)',
      bodyBg: '#fafaf8',
    },
    Card: {
      borderRadiusLG: 14,
    },
    Menu: {
      itemBg: 'transparent',
      darkItemBg: 'transparent',
    },
  },
};

export const darkAntdTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#6366f1',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    borderRadius: 10,
    fontFamily: FONT_FAMILY,
    colorBgLayout: '#0a0a0f',
    colorBgContainer: '#111827',
    colorText: '#f1f5f9',
    colorTextSecondary: '#94a3b8',
    colorBorder: 'rgba(255,255,255,0.08)',
    colorBorderSecondary: 'rgba(255,255,255,0.04)',
    controlHeight: 38,
    fontWeightStrong: 700,
    fontSize: 14,
  },
  components: {
    Layout: {
      siderBg: 'transparent',
      headerBg: 'rgba(17,24,39,0.8)',
      bodyBg: '#0a0a0f',
    },
    Card: {
      borderRadiusLG: 14,
    },
    Menu: {
      itemBg: 'transparent',
      darkItemBg: 'transparent',
    },
  },
};

// Chart colors per theme
export const CHART_COLORS_LIGHT = ['#4338ca', '#dc2626', '#d97706', '#059669', '#7c3aed', '#ea580c', '#0891b2', '#db2777'];
export const CHART_COLORS_DARK = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#f97316', '#06b6d4', '#ec4899'];
