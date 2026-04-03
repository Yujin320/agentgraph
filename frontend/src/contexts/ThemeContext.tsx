import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  lightColors, darkColors,
  lightAntdTheme, darkAntdTheme,
  CHART_COLORS_LIGHT, CHART_COLORS_DARK,
  type ThemeColors,
} from '../styles/themes';
import type { ThemeConfig } from 'antd';

type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  toggleTheme: () => void;
  colors: ThemeColors;
  antdTheme: ThemeConfig;
  chartColors: string[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'dataagent-theme';

function applyCSSSVariables(colors: ThemeColors, mode: ThemeMode) {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);

  // Set all CSS custom properties
  const entries = Object.entries(colors) as [string, string][];
  for (const [key, value] of entries) {
    // Convert camelCase to kebab-case
    const cssVar = '--da-' + key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    root.style.setProperty(cssVar, value);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return 'light';
  });

  const colors = mode === 'dark' ? darkColors : lightColors;
  const themeConfig = mode === 'dark' ? darkAntdTheme : lightAntdTheme;
  const chartColors = mode === 'dark' ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyCSSSVariables(colors, mode);
  }, [mode, colors]);

  const toggleTheme = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo(() => ({
    mode,
    toggleTheme,
    colors,
    antdTheme: themeConfig,
    chartColors,
  }), [mode, toggleTheme, colors, themeConfig, chartColors]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
