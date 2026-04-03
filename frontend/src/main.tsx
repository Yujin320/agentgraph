import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import App from './App';
import './styles/global.css';

function ThemedApp() {
  const { antdTheme } = useTheme();
  return (
    <ConfigProvider theme={antdTheme} locale={zhCN}>
      <App />
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
