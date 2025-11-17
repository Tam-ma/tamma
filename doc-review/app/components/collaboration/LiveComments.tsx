/**
 * Example component demonstrating real-time comment updates
 */

import { useState, useEffect, useCallback } from 'react';
import { useRealtimeEvents } from '~/hooks/useRealtimeEvents';
import type { Comment } from '~/lib/types/document';

interface LiveCommentsProps {
  docPath: string;
  initialComments?: Comment[];
}

export function LiveComments({ docPath, initialComments = [] }: LiveCommentsProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);

  // Handle comment events
  const handleCommentEvent = useCallback((event: {
    type: 'created' | 'updated' | 'deleted';
    data: Comment | { id: string };
  }) => {
    setLastEventTime(new Date());

    switch (event.type) {
      case 'created':
        const newComment = event.data as Comment;
        setComments(prev => {
          // Check if comment already exists (deduplication)
          if (prev.some(c => c.id === newComment.id)) {
            return prev;
          }
          return [...prev, newComment].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        });
        break;

      case 'updated':
        const updatedComment = event.data as Comment;
        setComments(prev => prev.map(c =>
          c.id === updatedComment.id ? updatedComment : c
        ));
        break;

      case 'deleted':
        const { id } = event.data as { id: string };
        setComments(prev => prev.filter(c => c.id !== id));
        break;
    }
  }, []);

  // Handle user presence events
  const handlePresenceEvent = useCallback((event: {
    userId: string;
    status: 'online' | 'offline';
  }) => {
    setOnlineUsers(prev => {
      const updated = new Set(prev);
      if (event.status === 'online') {
        updated.add(event.userId);
      } else {
        updated.delete(event.userId);
      }
      return updated;
    });
  }, []);

  // Connect to real-time events
  const { connected, connecting, error, reconnect } = useRealtimeEvents({
    docPath,
    onComment: handleCommentEvent,
    onPresence: handlePresenceEvent,
    onConnect: () => setConnectionStatus('connected'),
    onDisconnect: () => setConnectionStatus('disconnected'),
    onError: (err) => {
      console.error('Real-time connection error:', err);
      setConnectionStatus('disconnected');
    }
  });

  // Update connection status
  useEffect(() => {
    if (connecting) {
      setConnectionStatus('connecting');
    } else if (connected) {
      setConnectionStatus('connected');
    } else {
      setConnectionStatus('disconnected');
    }
  }, [connecting, connected]);

  // Auto-reconnect on disconnect
  useEffect(() => {
    if (connectionStatus === 'disconnected' && !connecting) {
      const timer = setTimeout(() => {
        reconnect();
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [connectionStatus, connecting, reconnect]);

  return (
    <div className="space-y-4">
      {/* Connection Status Indicator */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500' :
            connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            'bg-red-500'
          }`} />
          <span className="text-sm text-gray-600">
            {connectionStatus === 'connected' ? 'Live updates active' :
             connectionStatus === 'connecting' ? 'Connecting...' :
             'Disconnected'}
          </span>
        </div>

        <div className="flex items-center space-x-4">
          {/* Online Users Count */}
          {onlineUsers.size > 0 && (
            <div className="flex items-center space-x-1">
              <div className="flex -space-x-2">
                {Array.from(onlineUsers).slice(0, 3).map((userId, i) => (
                  <div
                    key={userId}
                    className="w-6 h-6 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center"
                    title={userId}
                  >
                    <span className="text-xs text-white font-medium">
                      {userId.substring(0, 1).toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
              {onlineUsers.size > 3 && (
                <span className="text-sm text-gray-600">
                  +{onlineUsers.size - 3}
                </span>
              )}
              <span className="text-sm text-gray-600">
                online
              </span>
            </div>
          )}

          {/* Last Event Time */}
          {lastEventTime && (
            <span className="text-xs text-gray-500">
              Last update: {lastEventTime.toLocaleTimeString()}
            </span>
          )}

          {/* Reconnect Button */}
          {connectionStatus === 'disconnected' && (
            <button
              onClick={reconnect}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Reconnect
            </button>
          )}
        </div>
      </div>

      {/* Comments List */}
      <div className="space-y-3">
        {comments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No comments yet. Be the first to comment!
          </div>
        ) : (
          comments.map(comment => (
            <CommentCard
              key={comment.id}
              comment={comment}
              isLive={connectionStatus === 'connected'}
            />
          ))
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-4 py-3 bg-red-50 text-red-700 rounded-lg">
          <p className="text-sm">
            Failed to connect to real-time updates. Comments will still be loaded but may not update automatically.
          </p>
        </div>
      )}
    </div>
  );
}

interface CommentCardProps {
  comment: Comment;
  isLive: boolean;
}

function CommentCard({ comment, isLive }: CommentCardProps) {
  const [isNew, setIsNew] = useState(false);

  // Flash animation for new comments
  useEffect(() => {
    if (isLive) {
      setIsNew(true);
      const timer = setTimeout(() => setIsNew(false), 500);
      return () => clearTimeout(timer);
    }
  }, [comment.id, isLive]);

  return (
    <div
      className={`p-4 bg-white rounded-lg border transition-all duration-300 ${
        isNew ? 'border-blue-400 shadow-md scale-[1.02]' : 'border-gray-200'
      } ${comment.resolved ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          {/* Author Avatar */}
          {comment.author?.avatarUrl ? (
            <img
              src={comment.author.avatarUrl}
              alt={comment.author.name}
              className="w-8 h-8 rounded-full"
            />
          ) : (
            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
              <span className="text-xs text-gray-600">
                {comment.author?.name?.charAt(0).toUpperCase() || '?'}
              </span>
            </div>
          )}

          <div className="flex-1">
            {/* Author and Time */}
            <div className="flex items-center space-x-2">
              <span className="font-medium text-sm">
                {comment.author?.name || 'Unknown User'}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(comment.createdAt).toLocaleString()}
              </span>
              {comment.updatedAt !== comment.createdAt && (
                <span className="text-xs text-gray-500">(edited)</span>
              )}
            </div>

            {/* Line Reference */}
            {comment.lineNumber && (
              <div className="text-xs text-gray-600 mt-1">
                Line {comment.lineNumber}: <code className="bg-gray-100 px-1 rounded">
                  {comment.lineContent?.substring(0, 50)}...
                </code>
              </div>
            )}

            {/* Comment Content */}
            <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">
              {comment.content}
            </div>

            {/* Resolved Badge */}
            {comment.resolved && (
              <span className="inline-block mt-2 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                Resolved
              </span>
            )}
          </div>
        </div>

        {/* Live Indicator */}
        {isLive && isNew && (
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
            <span className="text-xs text-blue-600 font-medium">New</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default LiveComments;