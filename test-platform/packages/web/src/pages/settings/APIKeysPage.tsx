'use client';

import { useState, useMemo } from 'react';
import { Search, Plus, MoreVertical, Trash2, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { useAPIKeys } from '@/hooks/useAPIKeys';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { GenerateKeyModal } from '@/components/api-keys/GenerateKeyModal';
import { KeyGeneratedModal } from '@/components/api-keys/KeyGeneratedModal';
import { KeyDetailsModal } from '@/components/api-keys/KeyDetailsModal';
import { RevokeKeyModal } from '@/components/api-keys/RevokeKeyModal';
import type { APIKey, APIKeyFilters } from '@/types/api-key.types';

export const APIKeysPage: React.FC = () => {
  const [filters, setFilters] = useState<APIKeyFilters>({
    page: 1,
    pageSize: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<{ apiKey: APIKey; fullKey: string } | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<APIKey | null>(null);

  const { keys, total, isLoading, createKey, revokeKey } = useAPIKeys(filters);

  // Filter keys locally by search term
  const filteredKeys = useMemo(() => {
    if (!searchTerm) return keys;
    const term = searchTerm.toLowerCase();
    return keys.filter(
      (key) =>
        key.name.toLowerCase().includes(term) ||
        key.keyPrefix.toLowerCase().includes(term) ||
        key.description?.toLowerCase().includes(term)
    );
  }, [keys, searchTerm]);

  const handleGenerateKey = async (data: any) => {
    try {
      const result = await createKey(data);
      setGeneratedKey(result);
      setShowGenerateModal(false);
    } catch (error) {
      console.error('Failed to create API key:', error);
    }
  };

  const handleRevokeKey = async () => {
    if (!keyToRevoke) return;
    
    try {
      await revokeKey(keyToRevoke.id);
      setKeyToRevoke(null);
    } catch (error) {
      console.error('Failed to revoke API key:', error);
    }
  };

  const totalPages = Math.ceil(total / (filters.pageSize || 10));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">API Keys</h1>
        <p className="mt-2 text-gray-600">
          Manage your API keys for programmatic access to the Tamma platform
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="card p-6">
          <div className="text-sm font-medium text-gray-600">Total Keys</div>
          <div className="mt-2 text-3xl font-bold text-gray-900">{total}</div>
        </div>
        <div className="card p-6">
          <div className="text-sm font-medium text-gray-600">Active Keys</div>
          <div className="mt-2 text-3xl font-bold text-green-600">
            {keys.filter((k) => k.status === 'active').length}
          </div>
        </div>
        <div className="card p-6">
          <div className="text-sm font-medium text-gray-600">Total Requests (30d)</div>
          <div className="mt-2 text-3xl font-bold text-gray-900">
            {keys.reduce((acc, k) => acc + k.usage.requestsThisPeriod, 0).toLocaleString()}
          </div>
        </div>
        <div className="card p-6">
          <div className="text-sm font-medium text-gray-600">Avg Success Rate</div>
          <div className="mt-2 text-3xl font-bold text-green-600">
            {keys.length > 0
              ? (
                  keys.reduce((acc, k) => acc + k.usage.successRate, 0) / keys.length
                ).toFixed(1)
              : '0'}
            %
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search API keys..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10 w-full"
            aria-label="Search API keys"
          />
        </div>
        <button
          onClick={() => setShowGenerateModal(true)}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Generate New Key
        </button>
      </div>

      {/* API Keys Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading API keys...</div>
        ) : filteredKeys.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500">No API keys found</p>
            {!searchTerm && (
              <button
                onClick={() => setShowGenerateModal(true)}
                className="btn-primary mt-4"
              >
                Generate Your First Key
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Key Prefix
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Used
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Requests (30d)
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredKeys.map((key) => (
                  <tr key={key.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <button
                          onClick={() => setSelectedKeyId(key.id)}
                          className="text-sm font-medium text-primary-600 hover:text-primary-800"
                        >
                          {key.name}
                        </button>
                        {key.description && (
                          <div className="text-xs text-gray-500 mt-1">{key.description}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">
                        {key.keyPrefix}...
                      </code>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={key.status} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {format(new Date(key.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {key.lastUsedAt
                        ? format(new Date(key.lastUsedAt), 'MMM d, yyyy')
                        : 'Never'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {key.usage.requestsThisPeriod.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setSelectedKeyId(key.id)}
                          className="p-2 text-gray-400 hover:text-primary-600 transition-colors"
                          aria-label="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setKeyToRevoke(key)}
                          className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                          aria-label="Revoke key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Showing {(filters.page! - 1) * filters.pageSize! + 1} to{' '}
              {Math.min(filters.page! * filters.pageSize!, total)} of {total} results
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setFilters({ ...filters, page: filters.page! - 1 })}
                disabled={filters.page === 1}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setFilters({ ...filters, page: filters.page! + 1 })}
                disabled={filters.page === totalPages}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <GenerateKeyModal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onGenerate={handleGenerateKey}
      />

      {generatedKey && (
        <KeyGeneratedModal
          isOpen={!!generatedKey}
          onClose={() => setGeneratedKey(null)}
          apiKey={generatedKey.apiKey}
          fullKey={generatedKey.fullKey}
        />
      )}

      {selectedKeyId && (
        <KeyDetailsModal
          isOpen={!!selectedKeyId}
          onClose={() => setSelectedKeyId(null)}
          keyId={selectedKeyId}
        />
      )}

      {keyToRevoke && (
        <RevokeKeyModal
          isOpen={!!keyToRevoke}
          onClose={() => setKeyToRevoke(null)}
          apiKey={keyToRevoke}
          onConfirm={handleRevokeKey}
        />
      )}
    </div>
  );
};
