'use client';

import { useState, useRef } from 'react';
import { Check, Copy, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { APIKey } from '@/types/api-key.types';

interface KeyGeneratedModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: APIKey;
  fullKey: string;
}

export const KeyGeneratedModal: React.FC<KeyGeneratedModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  fullKey,
}) => {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const keyRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const handleClose = () => {
    if (confirmed) {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="API Key Generated Successfully"
      size="lg"
      showCloseButton={false}
    >
      <div className="space-y-6">
        {/* Warning Banner */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertTriangle className="w-5 h-5 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-800">
              <p className="font-semibold mb-1">Important: Save Your API Key Now</p>
              <p>
                This is the only time you will see this key. If you lose it, you'll need to
                generate a new one.
              </p>
            </div>
          </div>
        </div>

        {/* Key Information */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Key Name
          </label>
          <div className="text-sm text-gray-900 font-medium">{apiKey.name}</div>
        </div>

        {/* API Key Display */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Your API Key
          </label>
          <div
            ref={keyRef}
            className="relative bg-gray-50 border border-gray-300 rounded-lg p-4 font-mono text-sm break-all select-all"
          >
            {fullKey}
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 p-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4 text-gray-600" />
              )}
            </button>
          </div>
          {copied && (
            <p className="mt-2 text-sm text-green-600 flex items-center">
              <Check className="w-4 h-4 mr-1" />
              Copied to clipboard!
            </p>
          )}
        </div>

        {/* Storage Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            How to Store Your API Key Securely
          </h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Use environment variables in your application</li>
            <li>Store in a secure password manager</li>
            <li>Never commit keys to version control</li>
            <li>Use secrets management services for production</li>
          </ul>
        </div>

        {/* Confirmation Checkbox */}
        <label className="flex items-start cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 mr-3 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
          />
          <span className="text-sm text-gray-700">
            I have saved this API key in a secure location and understand that I won't be able
            to see it again.
          </span>
        </label>

        {/* Actions */}
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <button
            onClick={handleClose}
            disabled={!confirmed}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
};
