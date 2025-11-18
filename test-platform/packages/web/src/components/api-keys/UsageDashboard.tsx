'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { TrendingUp, TrendingDown, Activity, AlertCircle } from 'lucide-react';
import type { APIKeyUsageDetails } from '@/types/api-key.types';

interface UsageDashboardProps {
  usage: APIKeyUsageDetails;
  isLoading?: boolean;
}

export const UsageDashboard: React.FC<UsageDashboardProps> = ({ usage, isLoading }) => {
  const chartData = useMemo(() => {
    return usage.overTime.map((item) => ({
      date: format(parseISO(item.timestamp), 'MMM dd'),
      requests: item.requests,
      errors: item.errors,
      successRate: item.requests > 0 ? ((item.requests - item.errors) / item.requests) * 100 : 100,
    }));
  }, [usage.overTime]);

  const endpointData = useMemo(() => {
    return usage.byEndpoint.map((item) => ({
      name: item.endpoint,
      requests: item.count,
      errors: item.errorCount,
      successRate: item.count > 0 ? ((item.count - item.errorCount) / item.count) * 100 : 100,
    }));
  }, [usage.byEndpoint]);

  const totalRequests = useMemo(() => {
    return usage.overTime.reduce((sum, item) => sum + item.requests, 0);
  }, [usage.overTime]);

  const totalErrors = useMemo(() => {
    return usage.overTime.reduce((sum, item) => sum + item.errors, 0);
  }, [usage.overTime]);

  const successRate = useMemo(() => {
    return totalRequests > 0 ? ((totalRequests - totalErrors) / totalRequests) * 100 : 100;
  }, [totalRequests, totalErrors]);

  const avgRequestsPerDay = useMemo(() => {
    const days = usage.overTime.length;
    return days > 0 ? Math.round(totalRequests / days) : 0;
  }, [totalRequests, usage.overTime.length]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading usage data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-gray-600 mb-1">Total Requests</div>
              <div className="text-2xl font-bold text-gray-900">
                {totalRequests.toLocaleString()}
              </div>
            </div>
            <Activity className="w-8 h-8 text-primary-600" />
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-gray-600 mb-1">Avg/Day</div>
              <div className="text-2xl font-bold text-gray-900">
                {avgRequestsPerDay.toLocaleString()}
              </div>
            </div>
            <TrendingUp className="w-8 h-8 text-green-600" />
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-gray-600 mb-1">Success Rate</div>
              <div className="text-2xl font-bold text-green-600">{successRate.toFixed(1)}%</div>
            </div>
            <TrendingUp className="w-8 h-8 text-green-600" />
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-gray-600 mb-1">Total Errors</div>
              <div className="text-2xl font-bold text-red-600">{totalErrors.toLocaleString()}</div>
            </div>
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
        </div>
      </div>

      {/* Requests Over Time */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Requests Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="requests"
              stroke="#0ea5e9"
              strokeWidth={2}
              name="Requests"
            />
            <Line
              type="monotone"
              dataKey="errors"
              stroke="#ef4444"
              strokeWidth={2}
              name="Errors"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Usage by Endpoint */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Usage by Endpoint</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={endpointData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="requests" fill="#0ea5e9" name="Requests" />
            <Bar dataKey="errors" fill="#ef4444" name="Errors" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Requests Table */}
      <div className="card overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent Requests</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Timestamp
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Endpoint
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {usage.recentRequests.slice(0, 10).map((request, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {format(parseISO(request.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 font-mono">
                    {request.endpoint}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        request.statusCode >= 200 && request.statusCode < 300
                          ? 'bg-green-100 text-green-800'
                          : request.statusCode >= 400 && request.statusCode < 500
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {request.statusCode}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 font-mono">
                    {request.ipAddress}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
