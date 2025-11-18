import { useLoaderData, Link } from 'react-router';
import type { MetaFunction } from 'react-router';
import { LoginButton } from '../components/auth/LoginButton';
import { UserMenu } from '../components/auth/UserMenu';
import { getUser } from '../lib/auth/session.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Tamma doc-review - Home' },
    { name: 'description', content: 'Collaborative documentation review platform for Tamma' }
  ];
};

export async function loader({ request, context }: any) {
  const user = await getUser(request, context);

  return { user };
}

export default function Index() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">Tamma Documentation Review</h1>
            </div>
            <div className="flex items-center">
              {user ? <UserMenu user={user} /> : <LoginButton provider="github" />}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              {user ? (
                <div>
                  <h2 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                    Welcome back, {user.name}!
                  </h2>
                  <div className="text-gray-600">
                    <p className="mb-4">
                      You're ready to start reviewing documentation. Choose a document from the
                      navigation:
                    </p>
                    <div className="space-y-4">
                      <Link
                        to="/search"
                        className="block px-4 py-2 border border-gray-300 rounded-md text-blue-700 hover:bg-blue-50"
                      >
                        🔍 Search Documentation
                      </Link>
                      <Link
                        to="/docs/prd"
                        className="block px-4 py-2 border border-gray-300 rounded-md text-blue-700 hover:bg-blue-50"
                      >
                        📋 Product Requirements (PRD)
                      </Link>
                      <Link
                        to="/docs/architecture"
                        className="block px-4 py-2 border border-gray-300 rounded-md text-blue-700 hover:bg-blue-50"
                      >
                        🏗️ Architecture
                      </Link>
                      <Link
                        to="/docs/epics"
                        className="block px-4 py-2 border border-gray-300 rounded-md text-blue-700 hover:bg-blue-50"
                      >
                        📚 Epics & Stories
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <h2 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                    Welcome to Tamma Documentation Review
                  </h2>
                  <div className="text-gray-600">
                    <p className="mb-4">
                      A collaborative platform for reviewing, commenting, and suggesting edits to
                      Tamma's technical documentation using Git authentication.
                    </p>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                      <h3 className="text-sm font-medium text-blue-800 mb-2">
                        🔐 Git-Based Authentication
                      </h3>
                      <p className="text-sm text-blue-700">
                        Login with your GitHub account to access documentation. Your Git permissions
                        automatically determine your access level - no separate user management
                        needed!
                      </p>
                    </div>
                    <div className="text-center">
                      <LoginButton provider="github" />
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-900 mb-3">🚀 Features Available:</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                  <div>
                    <h4 className="font-medium text-gray-900">📝 Documentation</h4>
                    <ul className="mt-1 space-y-1">
                      <li>• Markdown rendering</li>
                      <li>• Syntax highlighting</li>
                      <li>• Line numbers</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">💬 Collaboration</h4>
                    <ul className="mt-1 space-y-1">
                      <li>• Inline comments</li>
                      <li>• Edit suggestions</li>
                      <li>• Document discussions</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">🔐 Authentication</h4>
                    <ul className="mt-1 space-y-1">
                      <li>• GitHub OAuth</li>
                      <li>• Git permissions</li>
                      <li>• Session management</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">🏗️ Architecture</h4>
                    <ul className="mt-1 space-y-1">
                      <li>• Edge deployment</li>
                      <li>• D1 database</li>
                      <li>• KV caching</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
