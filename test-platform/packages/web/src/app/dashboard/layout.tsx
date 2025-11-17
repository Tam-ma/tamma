'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AuthIndicator } from '@/components/layout/AuthIndicator';
import { SessionWarningModal } from '@/components/modals/SessionWarningModal';
import { useAuth } from '@/contexts/AuthContext';

function DashboardHeader() {
  const { refreshToken, logout } = useAuth();

  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <div className="h-8 w-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xl font-bold">T</span>
            </div>
            <span className="ml-2 text-xl font-semibold text-gray-900">
              Tamma Test Platform
            </span>
          </div>
          <AuthIndicator />
        </div>
      </div>
      <SessionWarningModal
        onStaySignedIn={refreshToken}
        onSignOut={logout}
      />
    </header>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50">
        <DashboardHeader />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </AuthProvider>
  );
}
