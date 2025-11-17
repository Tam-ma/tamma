'use client';

import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { APIKey } from '@/types/api-key.types';

interface RevokeKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: APIKey;
  onConfirm: () => Promise<void>;
}

export const RevokeKeyModal: React.FC<RevokeKeyModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onConfirm,
}) => {
  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" showCloseButton={false}>
      <div className="space-y-6">
        {/* Warning Icon */}
        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full">
          <AlertTriangle className="w-6 h-6 text-red-600" />
        </div>

        {/* Title */}
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Revoke API Key?
          </h2>
          <p className="text-sm text-gray-600">
            This action cannot be undone
          </p>
        </div>

        {/* Key Information */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-sm">
            <div className="font-medium text-gray-700 mb-1">Key Name</div>
            <div className="text-gray-900">{apiKey.name}</div>
          </div>
          <div className="text-sm mt-3">
            <div className="font-medium text-gray-700 mb-1">Key Prefix</div>
            <code className="text-xs bg-white px-2 py-1 rounded border border-gray-300">
              {apiKey.keyPrefix}...
            </code>
          </div>
        </div>

        {/* Consequences */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-red-900 mb-2">
            What will happen:
          </h3>
          <ul className="text-sm text-red-800 space-y-2">
            <li className="flex items-start">
              <span className="mr-2">"</span>
              <span>All applications using this key will immediately lose access</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">"</span>
              <span>This action cannot be undone</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">"</span>
              <span>In-flight requests may fail</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">"</span>
              <span>You'll need to generate a new key to restore access</span>
            </li>
          </ul>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleConfirm} className="btn-danger">
            Revoke Key
          </button>
        </div>
      </div>
    </Modal>
  );
};
