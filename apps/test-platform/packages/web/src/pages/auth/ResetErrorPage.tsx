'use client';

import { AlertCircle, Clock, Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function ResetErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4 py-12">
      <div className="w-full max-w-md">
        <Card>
          <div className="text-center">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', duration: 0.6, bounce: 0.4 }}
              className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-6"
            >
              <AlertCircle className="h-12 w-12 text-red-600" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Reset link expired or invalid
              </h1>
              <p className="text-gray-600 mb-6">
                The password reset link you used is no longer valid
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-4 mb-6"
            >
              <div className="p-4 bg-amber-50 rounded-lg text-left">
                <div className="flex gap-3 mb-3">
                  <Clock className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-900">
                    <p className="font-medium mb-1">Why did this happen?</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li>Password reset links expire after 1 hour for security</li>
                      <li>Links can only be used once</li>
                      <li>The link may have been typed incorrectly</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-blue-50 rounded-lg text-left">
                <div className="flex gap-3">
                  <Shield className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-900">
                    <p className="font-medium mb-1">What to do next:</p>
                    <ol className="space-y-1 list-decimal list-inside">
                      <li>Request a new password reset link</li>
                      <li>Check your email inbox (and spam folder)</li>
                      <li>Click the new link within 1 hour</li>
                      <li>Complete your password reset</li>
                    </ol>
                  </div>
                </div>
              </div>
            </motion.div>

            <div className="space-y-3">
              <Button asChild fullWidth size="lg">
                <Link href="/auth/forgot-password">Request New Reset Link</Link>
              </Button>

              <Button asChild variant="outline" fullWidth>
                <Link href="/auth/login">
                  <ArrowLeft className="h-4 w-4" />
                  Return to Sign In
                </Link>
              </Button>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-xs text-gray-600">
                Having trouble? Contact our support team for assistance.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
