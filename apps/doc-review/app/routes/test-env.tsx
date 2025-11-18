import { useLoaderData } from 'react-router';

export async function loader({ context }: any) {
  return {
    env: context.env,
    repoPath: context.env?.REPO_PATH,
    hasDb: !!context.env?.DB,
    hasCache: !!context.env?.CACHE,
  };
}

export default function TestEnv() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Environment Test</h1>
      <pre className="bg-gray-100 p-4 rounded">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
