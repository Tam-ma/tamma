/**
 * Example usage of real-time collaboration components
 */

import { useState } from 'react';
import { LiveComments } from './LiveComments';
import { useRealtimeEvents } from '~/hooks/useRealtimeEvents';
import type { Suggestion, Discussion } from '~/lib/types/document';

interface RealtimeExampleProps {
  docPath: string;
}

export function RealtimeExample({ docPath }: RealtimeExampleProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  // Subscribe to all real-time events
  const { connected } = useRealtimeEvents({
    docPath,
    onSuggestion: (event) => {
      // Update suggestions list
      if (event.type === 'created') {
        setSuggestions(prev => [...prev, event.data]);
      } else if (event.type === 'approved') {
        setSuggestions(prev => prev.map(s =>
          s.id === event.data.id ? { ...s, status: 'approved' } : s
        ));
      }

      // Add to activity feed
      setActivities(prev => [{
        type: 'suggestion',
        action: event.type,
        data: event.data,
        timestamp: new Date()
      }, ...prev].slice(0, 20));
    },
    onDiscussion: (event) => {
      // Update discussions list
      if (event.type === 'created') {
        setDiscussions(prev => [...prev, event.data]);
      }

      // Add to activity feed
      setActivities(prev => [{
        type: 'discussion',
        action: event.type,
        data: event.data,
        timestamp: new Date()
      }, ...prev].slice(0, 20));
    },
    onComment: (event) => {
      // Add to activity feed
      setActivities(prev => [{
        type: 'comment',
        action: event.type,
        data: event.data,
        timestamp: new Date()
      }, ...prev].slice(0, 20));
    }
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Content Area */}
      <div className="lg:col-span-2">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Live Comments</h2>
          <LiveComments docPath={docPath} />
        </div>

        {/* Suggestions Panel */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            Suggestions
            {suggestions.length > 0 && (
              <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                {suggestions.length}
              </span>
            )}
          </h2>

          <div className="space-y-3">
            {suggestions.map(suggestion => (
              <div
                key={suggestion.id}
                className={`p-3 border rounded-lg ${
                  suggestion.status === 'approved' ? 'bg-green-50 border-green-300' :
                  suggestion.status === 'rejected' ? 'bg-red-50 border-red-300' :
                  'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium">{suggestion.description}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      Lines {suggestion.lineStart}-{suggestion.lineEnd}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    suggestion.status === 'approved' ? 'bg-green-200 text-green-800' :
                    suggestion.status === 'rejected' ? 'bg-red-200 text-red-800' :
                    'bg-yellow-200 text-yellow-800'
                  }`}>
                    {suggestion.status}
                  </span>
                </div>
              </div>
            ))}

            {suggestions.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                No suggestions yet
              </p>
            )}
          </div>
        </div>

        {/* Discussions Panel */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            Discussions
            {discussions.length > 0 && (
              <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
                {discussions.length}
              </span>
            )}
          </h2>

          <div className="space-y-3">
            {discussions.map(discussion => (
              <div
                key={discussion.id}
                className="p-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
              >
                <h4 className="text-sm font-medium">{discussion.title}</h4>
                {discussion.description && (
                  <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                    {discussion.description}
                  </p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    discussion.status === 'open' ? 'bg-blue-100 text-blue-700' :
                    discussion.status === 'resolved' ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {discussion.status}
                  </span>
                  {discussion.messageCount !== undefined && (
                    <span className="text-xs text-gray-500">
                      {discussion.messageCount} messages
                    </span>
                  )}
                </div>
              </div>
            ))}

            {discussions.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                No discussions yet
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Activity Feed Sidebar */}
      <div className="lg:col-span-1">
        <div className="bg-white rounded-lg shadow p-6 sticky top-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Activity Feed</h3>
            {connected && (
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-green-600">Live</span>
              </div>
            )}
          </div>

          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {activities.map((activity, index) => (
              <div
                key={index}
                className="p-3 bg-gray-50 rounded-lg text-sm animate-fadeIn"
              >
                <div className="flex items-start space-x-2">
                  {/* Activity Icon */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    activity.type === 'comment' ? 'bg-blue-100 text-blue-600' :
                    activity.type === 'suggestion' ? 'bg-yellow-100 text-yellow-600' :
                    'bg-purple-100 text-purple-600'
                  }`}>
                    {activity.type === 'comment' ? '💬' :
                     activity.type === 'suggestion' ? '💡' : '🗣️'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">
                      {activity.type === 'comment' ? 'Comment' :
                       activity.type === 'suggestion' ? 'Suggestion' : 'Discussion'}
                      {' '}
                      <span className="text-gray-600">
                        {activity.action}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {activity.timestamp.toLocaleTimeString()}
                    </p>
                    {activity.data.content && (
                      <p className="text-xs text-gray-600 mt-1 truncate">
                        {activity.data.content}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {activities.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-8">
                No activity yet. Actions will appear here in real-time.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Add CSS animation
const styles = `
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fadeIn {
  animation: fadeIn 0.3s ease-out;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
`;