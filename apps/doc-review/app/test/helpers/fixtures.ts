/**
 * Test data fixtures for integration tests
 */

/**
 * Comment fixture
 */
export interface CommentFixture {
  id: string;
  docPath: string;
  content: string;
  lineNumber: number | null;
  lineContent: string | null;
  userId: string;
  parentId: string | null;
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * Create a test comment
 */
export function createTestComment(
  overrides: Partial<CommentFixture> = {}
): CommentFixture {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    docPath: 'docs/test.md',
    content: 'This is a test comment',
    lineNumber: 10,
    lineContent: 'const foo = "bar";',
    userId: 'user-001',
    parentId: null,
    resolved: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Create threaded comments (parent with replies)
 */
export function createThreadedComments(
  parentOverrides: Partial<CommentFixture> = {},
  replyCount: number = 2
): CommentFixture[] {
  const parent = createTestComment(parentOverrides);
  const replies = Array.from({ length: replyCount }, (_, i) =>
    createTestComment({
      parentId: parent.id,
      content: `Reply ${i + 1} to parent comment`,
    })
  );

  return [parent, ...replies];
}

/**
 * Suggestion fixture
 */
export interface SuggestionFixture {
  id: string;
  docPath: string;
  lineStart: number;
  lineEnd: number;
  originalText: string;
  suggestedText: string;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'deleted';
  userId: string;
  sessionId: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * Create a test suggestion
 */
export function createTestSuggestion(
  overrides: Partial<SuggestionFixture> = {}
): SuggestionFixture {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    docPath: 'docs/test.md',
    lineStart: 10,
    lineEnd: 10,
    originalText: 'The quick brown fox',
    suggestedText: 'The fast brown fox',
    description: 'Improve wording',
    status: 'pending',
    userId: 'user-001',
    sessionId: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Discussion fixture
 */
export interface DiscussionFixture {
  id: string;
  docPath: string;
  title: string;
  description: string | null;
  status: 'open' | 'resolved' | 'closed';
  userId: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * Create a test discussion
 */
export function createTestDiscussion(
  overrides: Partial<DiscussionFixture> = {}
): DiscussionFixture {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    docPath: 'docs/test.md',
    title: 'Test Discussion',
    description: 'This is a test discussion',
    status: 'open',
    userId: 'user-001',
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Discussion message fixture
 */
export interface DiscussionMessageFixture {
  id: string;
  discussionId: string;
  content: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * Create a test discussion message
 */
export function createTestDiscussionMessage(
  discussionId: string,
  overrides: Partial<DiscussionMessageFixture> = {}
): DiscussionMessageFixture {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    discussionId,
    content: 'This is a test message',
    userId: 'user-001',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Review session fixture
 */
export interface ReviewSessionFixture {
  id: string;
  title: string;
  summary: string | null;
  docPaths: string; // JSON string
  primaryDocPath: string;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  status: 'draft' | 'in-review' | 'approved' | 'merged' | 'closed';
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Create a test review session
 */
export function createTestReviewSession(
  overrides: Partial<ReviewSessionFixture> = {}
): ReviewSessionFixture {
  const now = Date.now();
  const docPaths = ['docs/test.md', 'docs/example.md'];

  return {
    id: crypto.randomUUID(),
    title: 'Test Review Session',
    summary: 'Reviewing test documentation',
    docPaths: JSON.stringify(docPaths),
    primaryDocPath: docPaths[0],
    branch: null,
    prNumber: null,
    prUrl: null,
    status: 'draft',
    ownerId: 'user-001',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * User fixture (extends TestUser)
 */
export interface UserFixture {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: 'viewer' | 'editor' | 'reviewer' | 'admin';
  createdAt: number;
  updatedAt: number;
}

/**
 * Create a test user record (database format)
 */
export function createTestUserRecord(
  overrides: Partial<UserFixture> = {}
): UserFixture {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: 'https://example.com/avatar.jpg',
    role: 'editor',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Document metadata fixture
 */
export interface DocumentMetadataFixture {
  docPath: string;
  title: string;
  description: string | null;
  category: string | null;
  epicId: string | null;
  storyId: string | null;
  wordCount: number | null;
  lineCount: number | null;
  lastModified: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Create test document metadata
 */
export function createTestDocumentMetadata(
  overrides: Partial<DocumentMetadataFixture> = {}
): DocumentMetadataFixture {
  const now = Date.now();
  return {
    docPath: 'docs/test.md',
    title: 'Test Document',
    description: 'A test document',
    category: 'documentation',
    epicId: null,
    storyId: null,
    wordCount: 500,
    lineCount: 50,
    lastModified: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Activity log fixture
 */
export interface ActivityLogFixture {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: string | null;
  createdAt: number;
}

/**
 * Create test activity log entry
 */
export function createTestActivityLog(
  overrides: Partial<ActivityLogFixture> = {}
): ActivityLogFixture {
  return {
    id: crypto.randomUUID(),
    userId: 'user-001',
    action: 'created',
    resourceType: 'comment',
    resourceId: 'comment-001',
    metadata: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * Create a complete test dataset
 */
export function createCompleteTestDataset() {
  const user = createTestUserRecord({ id: 'user-001' });
  const session = createTestReviewSession({
    id: 'session-001',
    ownerId: user.id,
  });

  const comments = [
    createTestComment({ id: 'comment-001', userId: user.id }),
    createTestComment({
      id: 'comment-002',
      userId: user.id,
      parentId: 'comment-001',
    }),
  ];

  const suggestions = [
    createTestSuggestion({
      id: 'suggestion-001',
      userId: user.id,
      sessionId: session.id,
    }),
  ];

  const discussions = [
    createTestDiscussion({
      id: 'discussion-001',
      userId: user.id,
      sessionId: session.id,
    }),
  ];

  return {
    users: [user],
    reviewSessions: [session],
    comments,
    suggestions,
    discussions,
  };
}
