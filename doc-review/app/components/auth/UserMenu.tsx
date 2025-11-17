import type { OAuthUser } from '~/lib/auth/oauth.server';
import { Role } from '~/lib/auth/permissions';

interface UserWithRole extends OAuthUser {
  role?: string;
}

export function UserMenu({ user }: { user: UserWithRole }) {
  const getRoleBadgeStyles = (role?: string) => {
    switch (role?.toLowerCase()) {
      case Role.ADMIN:
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300 border-purple-200 dark:border-purple-700';
      case Role.REVIEWER:
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-200 dark:border-green-700';
      case Role.VIEWER:
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600';
    }
  };

  const getRoleLabel = (role?: string) => {
    switch (role?.toLowerCase()) {
      case Role.ADMIN:
        return 'Admin';
      case Role.REVIEWER:
        return 'Reviewer';
      case Role.VIEWER:
      default:
        return 'Viewer';
    }
  };

  return (
    <div className="flex items-center space-x-3">
      <img src={user.avatarUrl} alt={user.name} className="h-8 w-8 rounded-full" />
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {user.name}
          </span>
          {user.role && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getRoleBadgeStyles(user.role)}`}
            >
              {getRoleLabel(user.role)}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {user.provider}
        </span>
      </div>
      <div className="flex items-center gap-2 ml-4">
        {user.role === Role.ADMIN && (
          <a
            href="/admin/users"
            className="text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300"
            title="User Management"
          >
            Manage Users
          </a>
        )}
        <a
          href="/auth/logout"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Logout
        </a>
      </div>
    </div>
  );
}
