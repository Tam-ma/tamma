
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.js';

export function AppLayout(): JSX.Element {
  return (
    <div className="flex min-h-screen font-sans">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
