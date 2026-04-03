import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Chat from './pages/Chat';
import DataExplorer from './pages/DataExplorer';
import WorkspaceCreate from './pages/WorkspaceCreate';
import PipelineSetup from './pages/PipelineSetup';
import SchemaReview from './pages/SchemaReview';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<WorkspaceCreate />} />
      <Route path="/w/:workspace" element={<Chat />} />
      <Route path="/w/:workspace/explore" element={<DataExplorer />} />
      <Route path="/w/:workspace/setup" element={<PipelineSetup />} />
      <Route path="/w/:workspace/setup/schema" element={<SchemaReview />} />
      {/* Catch-all — redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
