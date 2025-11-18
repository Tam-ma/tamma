'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import { Edit2, Save, X, Shield, Activity, Info, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { UsageDashboard } from '@/components/api-keys/UsageDashboard';
import { useAPIKeyDetails, useAPIKeyUsage } from '@/hooks/useAPIKeys';
import type { UpdateAPIKeyRequest } from '@/types/api-key.types';

interface KeyDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  keyId: string;
}

type Tab = 'details' | 'usage' | 'security';

export const KeyDetailsModal: React.FC<KeyDetailsModalProps> = ({ isOpen, onClose, keyId }) => {
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [isEditing, setIsEditing] = useState(false);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  const { data: apiKey, isLoading: isLoadingKey } = useAPIKeyDetails(keyId);
  const { data: usage, isLoading: isLoadingUsage } = useAPIKeyUsage(keyId, timeRange);

  const { register, handleSubmit, reset } = useForm<UpdateAPIKeyRequest>({
    defaultValues: {
      name: apiKey?.name,
      description: apiKey?.description,
    },
  });

  const handleEdit = () => {
    if (apiKey) {
      reset({
        name: apiKey.name,
        description: apiKey.description,
      });
      setIsEditing(true);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    reset();
  };

  const onSubmit = async (data: UpdateAPIKeyRequest) => {
    // TODO: Call update API
    console.log('Update key:', data);
    setIsEditing(false);
  };

  const tabs = [
    { id: 'details' as Tab, label: 'Details', icon: Info },
    { id: 'usage' as Tab, label: 'Usage', icon: Activity },
    { id: 'security' as Tab, label: 'Security', icon: Shield },
  ];

  if (isLoadingKey) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Loading..." size="xl">
        <div className="flex items-center justify-center p-8">
          <div className="text-gray-500">Loading API key details...</div>
        </div>
      </Modal>
    );
  }

  if (!apiKey) {
    return null;
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="API Key Details" size="xl">
      <div className="space-y-6">
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Details Tab */}
        {activeTab === 'details' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Key Information</h3>
              {!isEditing && (
                <button onClick={handleEdit} className="btn-secondary text-sm flex items-center gap-2">
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                {isEditing ? (
                  <input {...register('name')} className="input" />
                ) : (
                  <div className="text-sm text-gray-900">{apiKey.name}</div>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                {isEditing ? (
                  <textarea {...register('description')} className="input" rows={3} />
                ) : (
                  <div className="text-sm text-gray-900">
                    {apiKey.description || 'No description provided'}
                  </div>
                )}
              </div>

              {/* Key Prefix */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Key Prefix</label>
                <code className="text-xs bg-gray-100 px-3 py-2 rounded font-mono block">
                  {apiKey.keyPrefix}...
                </code>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <StatusBadge status={apiKey.status} />
              </div>

              {/* Scopes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
                <div className="flex flex-wrap gap-2">
                  {apiKey.scopes.map((scope) => (
                    <Badge key={scope} variant="info">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Rate Limit */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Rate Limit</label>
                <div className="text-sm text-gray-900">
                  {apiKey.rateLimit.toLocaleString()} requests per hour
                </div>
              </div>

              {/* Created At */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Created</label>
                <div className="text-sm text-gray-900">
                  {format(new Date(apiKey.createdAt), 'MMMM dd, yyyy HH:mm:ss')}
                </div>
              </div>

              {/* Last Used */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Last Used</label>
                <div className="text-sm text-gray-900">
                  {apiKey.lastUsedAt
                    ? format(new Date(apiKey.lastUsedAt), 'MMMM dd, yyyy HH:mm:ss')
                    : 'Never used'}
                </div>
              </div>

              {/* Expires At */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Expires</label>
                <div className="text-sm text-gray-900">
                  {apiKey.expiresAt
                    ? format(new Date(apiKey.expiresAt), 'MMMM dd, yyyy')
                    : 'Never'}
                </div>
              </div>

              {/* Edit Actions */}
              {isEditing && (
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                  <button type="button" onClick={handleCancel} className="btn-secondary">
                    <X className="w-4 h-4 mr-1" />
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    <Save className="w-4 h-4 mr-1" />
                    Save Changes
                  </button>
                </div>
              )}
            </form>
          </div>
        )}

        {/* Usage Tab */}
        {activeTab === 'usage' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Usage Analytics</h3>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as '7d' | '30d' | '90d')}
                className="input w-auto"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
              </select>
            </div>

            {usage && <UsageDashboard usage={usage} isLoading={isLoadingUsage} />}
          </div>
        )}

        {/* Security Tab */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Security Settings</h3>
            </div>

            {/* IP Whitelist */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">IP Whitelist</label>
              {apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0 ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  {apiKey.ipWhitelist.map((ip, index) => (
                    <code key={index} className="block text-xs font-mono mb-1">
                      {ip}
                    </code>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">All IP addresses allowed</div>
              )}
            </div>

            {/* Last Used IP */}
            {apiKey.lastUsedIp && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Last Used IP Address
                </label>
                <code className="text-xs bg-gray-100 px-3 py-2 rounded font-mono block">
                  {apiKey.lastUsedIp}
                </code>
              </div>
            )}

            {/* Security Events */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Recent Security Events
              </label>
              {usage?.securityEvents && usage.securityEvents.length > 0 ? (
                <div className="space-y-2">
                  {usage.securityEvents.slice(0, 5).map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {event.event.replace(/_/g, ' ').toUpperCase()}
                        </div>
                        {event.details && (
                          <div className="text-xs text-gray-500 mt-1">{event.details}</div>
                        )}
                        {event.ipAddress && (
                          <code className="text-xs text-gray-600 mt-1 block">
                            IP: {event.ipAddress}
                          </code>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {format(new Date(event.timestamp), 'MMM dd, HH:mm')}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">No security events recorded</div>
              )}
            </div>

            {/* Revoke Key */}
            <div className="pt-6 border-t border-gray-200">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-red-900 mb-2">Danger Zone</h4>
                <p className="text-sm text-red-800 mb-4">
                  Revoking this API key will immediately disable all access. This action cannot be
                  undone.
                </p>
                <button className="btn-danger text-sm flex items-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  Revoke API Key
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
