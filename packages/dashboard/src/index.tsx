/**
 * @tamma/dashboard
 * React observability dashboard for the Tamma platform
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { KnowledgeBaseDashboard } from './pages/knowledge-base/KnowledgeBaseDashboard.js';

function App(): JSX.Element {
  return <KnowledgeBaseDashboard />;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
