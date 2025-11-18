import { Outlet, useLoaderData, useLocation } from 'react-router';
import { getUser } from '../lib/auth/session.server';
import { DocumentLoader } from '../lib/docs/loader.server';
import { Sidebar, Breadcrumbs } from '../components/navigation';

export async function loader({ request, context }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};

  // Get user if available (optional - docs can be viewed without auth)
  const user = await getUser(request, { env });

  const loader = DocumentLoader.forEnv(env);
  const navigation = await loader.getNavigation();

  return { navigation, user };
}

export default function DocsLayout() {
  const { navigation } = useLoaderData<typeof loader>();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        {/* Sidebar Navigation */}
        <Sidebar navigation={navigation} currentPath={location.pathname} />

        {/* Main Content Area */}
        <main className="flex-1 min-h-screen">
          {/* Header with Breadcrumbs */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
            <div className="px-6 py-4">
              <Breadcrumbs navigation={navigation} currentPath={location.pathname} />
            </div>
          </header>

          {/* Page Content */}
          <div className="px-6 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
