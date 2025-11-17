import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router';

interface ErrorMessageProps {
  title?: string;
  message: string;
  showHomeLink?: boolean;
}

export function ErrorMessage({
  title = 'Error',
  message,
  showHomeLink = true
}: ErrorMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
      <div className="flex items-center space-x-2 text-red-600 dark:text-red-400">
        <AlertCircle className="h-8 w-8" />
        <h2 className="text-2xl font-bold">{title}</h2>
      </div>
      <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">{message}</p>
      {showHomeLink && (
        <Link
          to="/"
          className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          Go to Home
        </Link>
      )}
    </div>
  );
}
