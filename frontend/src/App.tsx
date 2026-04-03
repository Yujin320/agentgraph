import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Chat from './pages/Chat';
import DataExplorer from './pages/DataExplorer';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/w/:workspace" element={<Chat />} />
      <Route path="/w/:workspace/explore" element={<DataExplorer />} />
      {/* Catch-all — redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
