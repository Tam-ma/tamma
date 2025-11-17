import { useState } from 'react';
import { type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/node';
import { useLoaderData, useFetcher, redirect } from '@remix-run/react';
import { requireAuthWithRole, requireRole } from '~/lib/auth/middleware';
import { Role, Permission, isValidRole, normalizeRole } from '~/lib/auth/permissions';
import { getAllUsers, updateUserRole } from '~/lib/db/users.server';
import { jsonResponse } from '~/lib/utils/responses';
import { parseRequestPayload } from '~/lib/utils/request.server';

interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: string;
  createdAt: number;
  updatedAt: number;
}

// GET /admin/users - List all users (admin only)
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.env ?? context.cloudflare?.env ?? {};

  // Require admin role
  const authResult = await requireRole(Role.ADMIN)({ request, context });

  // If authResult is a Response (forbidden), throw it
  if (authResult instanceof Response) {
    throw authResult;
  }

  // Get all users from database
  const users = await getAllUsers(env);

  return jsonResponse({
    users,
    currentUser: authResult,
  });
}

// POST /admin/users - Update user role (admin only)
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.env ?? context.cloudflare?.env ?? {};

  // Require admin role
  const authResult = await requireRole(Role.ADMIN)({ request, context });

  // If authResult is a Response (forbidden), return it
  if (authResult instanceof Response) {
    return authResult;
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await parseRequestPayload(request);
  const { userId, role } = body;

  if (!userId || !role) {
    return jsonResponse(
      { error: 'userId and role are required' },
      { status: 400 }
    );
  }

  // Validate role
  if (!isValidRole(role)) {
    return jsonResponse(
      { error: `Invalid role: ${role}. Must be one of: viewer, reviewer, admin` },
      { status: 400 }
    );
  }

  // Prevent self-demotion from admin
  if (userId === authResult.id && authResult.role === Role.ADMIN && role !== Role.ADMIN) {
    return jsonResponse(
      { error: 'You cannot remove your own admin privileges' },
      { status: 400 }
    );
  }

  // Update user role
  const normalizedRole = normalizeRole(role);
  const updatedUser = await updateUserRole(env, userId, normalizedRole);

  if (!updatedUser) {
    return jsonResponse(
      { error: 'User not found' },
      { status: 404 }
    );
  }

  return jsonResponse({
    user: updatedUser,
    message: `User role updated to ${normalizedRole}`,
  });
}

// Admin users management UI
export default function AdminUsers() {
  const { users, currentUser } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('');

  const handleRoleUpdate = (userId: string, currentRole: string) => {
    setSelectedUser(userId);
    setSelectedRole(currentRole);
  };

  const submitRoleChange = () => {
    if (!selectedUser || !selectedRole) return;

    fetcher.submit(
      { userId: selectedUser, role: selectedRole },
      { method: 'POST', encType: 'application/json' }
    );

    // Reset selection after submit
    setSelectedUser(null);
    setSelectedRole('');
  };

  const cancelRoleChange = () => {
    setSelectedUser(null);
    setSelectedRole('');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          User Management
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Manage user roles and permissions
        </p>
      </div>

      {/* Current user info */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
            {currentUser.name?.[0]?.toUpperCase() || 'A'}
          </div>
          <div>
            <p className="font-medium text-blue-900 dark:text-blue-100">
              You are logged in as: {currentUser.name}
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Role: {currentUser.role} (Administrator)
            </p>
          </div>
        </div>
      </div>

      {/* Users table */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {users.map((user: User) => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {user.avatarUrl ? (
                        <img
                          className="h-10 w-10 rounded-full"
                          src={user.avatarUrl}
                          alt=""
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                          <span className="text-gray-600 dark:text-gray-300 font-medium">
                            {user.name?.[0]?.toUpperCase() || '?'}
                          </span>
                        </div>
                      )}
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {user.name}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          ID: {user.id}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-gray-300">
                      {user.email}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {selectedUser === user.id ? (
                      <select
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        className="text-sm rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="reviewer">Reviewer</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                          ${user.role === 'admin'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300'
                            : user.role === 'reviewer'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                          }`}
                      >
                        {user.role}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {selectedUser === user.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={submitRoleChange}
                          className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelRoleChange}
                          className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleRoleUpdate(user.id, user.role)}
                        disabled={user.id === currentUser.id && user.role === 'admin'}
                        className={`
                          ${user.id === currentUser.id && user.role === 'admin'
                            ? 'text-gray-400 cursor-not-allowed'
                            : 'text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300'
                          }
                        `}
                        title={
                          user.id === currentUser.id && user.role === 'admin'
                            ? "You cannot change your own admin role"
                            : "Change role"
                        }
                      >
                        Change Role
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role descriptions */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
            Viewer
          </h3>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>• Read documents</li>
            <li>• View comments and suggestions</li>
            <li>• Cannot create or modify content</li>
          </ul>
        </div>

        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <h3 className="font-semibold text-green-900 dark:text-green-100 mb-2">
            Reviewer
          </h3>
          <ul className="text-sm text-green-700 dark:text-green-300 space-y-1">
            <li>• All viewer permissions</li>
            <li>• Create comments and discussions</li>
            <li>• Make suggestions</li>
            <li>• Modify own content</li>
          </ul>
        </div>

        <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
          <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
            Admin
          </h3>
          <ul className="text-sm text-purple-700 dark:text-purple-300 space-y-1">
            <li>• All reviewer permissions</li>
            <li>• Approve/reject suggestions</li>
            <li>• Manage user roles</li>
            <li>• Delete any content</li>
          </ul>
        </div>
      </div>

      {/* Display update messages */}
      {fetcher.data?.message && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-green-800 dark:text-green-200">
            {fetcher.data.message}
          </p>
        </div>
      )}

      {fetcher.data?.error && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">
            {fetcher.data.error}
          </p>
        </div>
      )}
    </div>
  );
}