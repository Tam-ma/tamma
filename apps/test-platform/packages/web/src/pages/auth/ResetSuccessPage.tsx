'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Shield, Lock, Key } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const AUTO_REDIRECT_SECONDS = 5;

export default function ResetSuccessPage() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push('/auth/login');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4 py-12">
      <div className="w-full max-w-md">
        <Card>
          <div className="text-center">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', duration: 0.6, bounce: 0.4 }}
              className="inline-flex items-center justify-center w-24 h-24 bg-green-100 rounded-full mb-6"
            >
              <CheckCircle className="h-16 w-16 text-green-600" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Password reset successful!
              </h1>
              <p className="text-gray-600 mb-6">
                Your password has been updated successfully
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-4 mb-6"
            >
              <div className="p-4 bg-green-50 rounded-lg text-left">
                <p className="text-sm text-green-900 mb-3 font-medium">
                  What happens next:
                </p>
                <ul className="space-y-2 text-sm text-green-800">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>You can now sign in with your new password</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>All your data and settings remain unchanged</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>Your old password no longer works</span>
                  </li>
                </ul>
              </div>

              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-800 text-center">
                  Redirecting to sign in in <strong>{countdown}</strong> second{countdown !== 1 ? 's' : ''}...
                </p>
              </div>
            </motion.div>

            <Button asChild fullWidth size="lg">
              <Link href="/auth/login">Sign In Now</Link>
            </Button>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-4">
                Keep your account secure:
              </p>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="space-y-2">
                  <div className="inline-flex items-center justify-center w-10 h-10 bg-primary-50 rounded-full">
                    <Shield className="h-5 w-5 text-primary-600" />
                  </div>
                  <p className="text-xs text-gray-600">Use unique passwords</p>
                </div>
                <div className="space-y-2">
                  <div className="inline-flex items-center justify-center w-10 h-10 bg-primary-50 rounded-full">
                    <Lock className="h-5 w-5 text-primary-600" />
                  </div>
                  <p className="text-xs text-gray-600">Enable 2FA when available</p>
                </div>
                <div className="space-y-2">
                  <div className="inline-flex items-center justify-center w-10 h-10 bg-primary-50 rounded-full">
                    <Key className="h-5 w-5 text-primary-600" />
                  </div>
                  <p className="text-xs text-gray-600">Use a password manager</p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
