import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/register" replace />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/login" element={<div className="min-h-screen flex items-center justify-center">Login Page - Coming Soon</div>} />
        <Route path="*" element={<div className="min-h-screen flex items-center justify-center">404 - Page Not Found</div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
