import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';

// Pages with full implementations
import Home from './pages/Home';
import WorkspaceCreate from './pages/WorkspaceCreate';
import PipelineSetup from './pages/PipelineSetup';
import SchemaReview from './pages/SchemaReview';
import DataGovernance from './pages/DataGovernance';
import AttributionExplorer from './pages/AttributionExplorer';

// Placeholder pages (will be replaced by other agents)
import CausalGraph from './pages/CausalGraph';
import DataBrowser from './pages/DataBrowser';
import QueryLogs from './pages/QueryLogs';
import SystemConfig from './pages/SystemConfig';

const App: React.FC = () => {
  return (
    <Routes>
      {/* Top-level routes (no sidebar layout) */}
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<WorkspaceCreate />} />

      {/* Workspace routes (with AppLayout sidebar) */}
      <Route element={<AppLayout />}>
        {/* Analyst */}
        <Route path="/w/:workspace" element={<AttributionExplorer />} />
        <Route path="/w/:workspace/graph" element={<CausalGraph />} />
        <Route path="/w/:workspace/data" element={<DataBrowser />} />
        {/* Admin */}
        <Route path="/w/:workspace/setup" element={<PipelineSetup />} />
        <Route path="/w/:workspace/setup/schema" element={<SchemaReview />} />
        <Route path="/w/:workspace/governance" element={<DataGovernance />} />
        <Route path="/w/:workspace/logs" element={<QueryLogs />} />
        <Route path="/w/:workspace/config" element={<SystemConfig />} />
      </Route>

      {/* Catch-all — redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
