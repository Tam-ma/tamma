#!/usr/bin/env tsx
/**
 * Database Seeding Script for Tamma Doc Review
 *
 * Seeds the D1 database with sample documents, comments, suggestions,
 * discussions, and users for testing and development.
 *
 * Usage:
 *   pnpm seed:db         - Seed local database
 *   pnpm seed:db:remote  - Seed production database (use with caution)
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const IS_REMOTE = process.env.SEED_REMOTE === 'true';
const DATABASE_NAME = 'tamma-docs';
const WRANGLER_FLAGS = IS_REMOTE ? '--remote' : '--local';

console.log(`🌱 Seeding ${IS_REMOTE ? 'PRODUCTION' : 'LOCAL'} database...`);

if (IS_REMOTE) {
  console.warn('⚠️  WARNING: You are about to seed the PRODUCTION database!');
  console.warn('   This will add test data to production.');
  console.warn('   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

  // Give user time to cancel
  execSync('sleep 5');
}

// Helper function to execute SQL
function executeSql(sql: string, description: string) {
  console.log(`📝 ${description}...`);

  // Write SQL to temporary file
  const tempFile = path.join(__dirname, '..', '.temp-seed.sql');
  writeFileSync(tempFile, sql, 'utf-8');

  const command = `pnpm wrangler d1 execute ${DATABASE_NAME} ${WRANGLER_FLAGS} --file="${tempFile}"`;

  try {
    execSync(command, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log(`✅ ${description} completed\n`);
  } catch (error) {
    console.error(`❌ Failed to ${description.toLowerCase()}`);
    throw error;
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tempFile);
    } catch {}
  }
}

// Seed data
const now = Date.now();

// 1. Sample Users
const users = [
  {
    id: 'user-admin-001',
    email: 'admin@tamma.dev',
    name: 'Admin User',
    avatar_url: 'https://avatar.vercel.sh/admin.png',
    role: 'admin',
  },
  {
    id: 'user-editor-001',
    email: 'editor@tamma.dev',
    name: 'Editor User',
    avatar_url: 'https://avatar.vercel.sh/editor.png',
    role: 'editor',
  },
  {
    id: 'user-reviewer-001',
    email: 'reviewer@tamma.dev',
    name: 'Reviewer User',
    avatar_url: 'https://avatar.vercel.sh/reviewer.png',
    role: 'reviewer',
  },
  {
    id: 'user-viewer-001',
    email: 'viewer@tamma.dev',
    name: 'Viewer User',
    avatar_url: 'https://avatar.vercel.sh/viewer.png',
    role: 'viewer',
  },
];

const usersSql = users.map(u =>
  `INSERT INTO users (id, email, name, avatar_url, role, created_at, updated_at)
   VALUES ('${u.id}', '${u.email}', '${u.name}', '${u.avatar_url}', '${u.role}', ${now}, ${now});`
).join('\n');

executeSql(usersSql, 'Creating sample users');

// 2. Sample Documents
const documents = [
  {
    doc_path: 'docs/architecture.md',
    title: 'System Architecture',
    description: 'Complete technical architecture for Tamma platform',
    category: 'architecture',
    epic_id: null,
    story_id: null,
    word_count: 12500,
    line_count: 450,
  },
  {
    doc_path: 'docs/PRD.md',
    title: 'Product Requirements Document',
    description: 'Complete product requirements and acceptance criteria',
    category: 'product',
    epic_id: null,
    story_id: null,
    word_count: 8000,
    line_count: 320,
  },
  {
    doc_path: 'docs/epics.md',
    title: 'Epic Breakdown',
    description: 'Epic breakdown with 58 stories',
    category: 'planning',
    epic_id: null,
    story_id: null,
    word_count: 15000,
    line_count: 580,
  },
  {
    doc_path: 'docs/stories/1-0-ai-provider-strategy-research.md',
    title: 'AI Provider Strategy Research',
    description: 'Research and compare AI providers for Tamma',
    category: 'story',
    epic_id: 'epic-1',
    story_id: '1-0',
    word_count: 3500,
    line_count: 180,
  },
  {
    doc_path: 'docs/stories/1-1-ai-provider-interface-definition.md',
    title: 'AI Provider Interface Definition',
    description: 'Define IAIProvider interface with streaming support',
    category: 'story',
    epic_id: 'epic-1',
    story_id: '1-1',
    word_count: 2800,
    line_count: 150,
  },
];

const documentsSql = documents.map(d =>
  `INSERT INTO document_metadata (doc_path, title, description, category, epic_id, story_id, word_count, line_count, last_modified, created_at, updated_at)
   VALUES ('${d.doc_path}', '${d.title}', '${d.description}', '${d.category}', ${d.epic_id ? `'${d.epic_id}'` : 'NULL'}, ${d.story_id ? `'${d.story_id}'` : 'NULL'}, ${d.word_count}, ${d.line_count}, ${now}, ${now}, ${now});`
).join('\n');

executeSql(documentsSql, 'Creating sample documents');

// 3. Sample Review Sessions
const sessions = [
  {
    id: 'session-001',
    title: 'Epic 1 Foundation Review',
    summary: 'Review all Epic 1 stories and architecture',
    doc_paths: JSON.stringify([
      'docs/stories/1-0-ai-provider-strategy-research.md',
      'docs/stories/1-1-ai-provider-interface-definition.md',
    ]),
    primary_doc_path: 'docs/stories/1-0-ai-provider-strategy-research.md',
    branch: 'epic-1-foundation',
    pr_number: null,
    pr_url: null,
    status: 'active',
    owner_id: 'user-admin-001',
  },
  {
    id: 'session-002',
    title: 'Architecture Document Review',
    summary: 'Complete review of system architecture document',
    doc_paths: JSON.stringify(['docs/architecture.md']),
    primary_doc_path: 'docs/architecture.md',
    branch: 'architecture-updates',
    pr_number: 42,
    pr_url: 'https://github.com/meywd/tamma/pull/42',
    status: 'completed',
    owner_id: 'user-editor-001',
  },
];

const sessionsSql = sessions.map(s =>
  `INSERT INTO review_sessions (id, title, summary, doc_paths, primary_doc_path, branch, pr_number, pr_url, status, owner_id, created_at, updated_at)
   VALUES ('${s.id}', '${s.title}', '${s.summary}', '${s.doc_paths}', '${s.primary_doc_path}', ${s.branch ? `'${s.branch}'` : 'NULL'}, ${s.pr_number || 'NULL'}, ${s.pr_url ? `'${s.pr_url}'` : 'NULL'}, '${s.status}', '${s.owner_id}', ${now}, ${now});`
).join('\n');

executeSql(sessionsSql, 'Creating sample review sessions');

// 4. Sample Comments
const comments = [
  {
    id: 'comment-001',
    doc_path: 'docs/architecture.md',
    line_number: 45,
    line_content: '## Event Sourcing Architecture',
    content: 'Should we consider using Kafka instead of PostgreSQL for event sourcing?',
    user_id: 'user-reviewer-001',
    parent_id: null,
    resolved: false,
  },
  {
    id: 'comment-002',
    doc_path: 'docs/architecture.md',
    line_number: 45,
    line_content: '## Event Sourcing Architecture',
    content: 'PostgreSQL is simpler and sufficient for our scale. We can migrate later if needed.',
    user_id: 'user-admin-001',
    parent_id: 'comment-001',
    resolved: false,
  },
  {
    id: 'comment-003',
    doc_path: 'docs/stories/1-0-ai-provider-strategy-research.md',
    line_number: 120,
    line_content: '### Cost Comparison',
    content: 'Excellent cost analysis! Consider adding OpenRouter as an alternative.',
    user_id: 'user-editor-001',
    parent_id: null,
    resolved: true,
  },
  {
    id: 'comment-004',
    doc_path: 'docs/PRD.md',
    line_number: 78,
    line_content: '## Success Metrics',
    content: 'We should add a metric for time-to-resolution of autonomous tasks.',
    user_id: 'user-reviewer-001',
    parent_id: null,
    resolved: false,
  },
];

const commentsSql = comments.map(c =>
  `INSERT INTO comments (id, doc_path, line_number, line_content, content, user_id, parent_id, resolved, created_at, updated_at)
   VALUES ('${c.id}', '${c.doc_path}', ${c.line_number}, '${c.line_content}', '${c.content}', '${c.user_id}', ${c.parent_id ? `'${c.parent_id}'` : 'NULL'}, ${c.resolved ? 1 : 0}, ${now}, ${now});`
).join('\n');

executeSql(commentsSql, 'Creating sample comments');

// 5. Sample Suggestions
const suggestions = [
  {
    id: 'suggestion-001',
    doc_path: 'docs/architecture.md',
    line_start: 100,
    line_end: 105,
    original_text: 'Node.js 20 LTS',
    suggested_text: 'Node.js 22 LTS',
    description: 'Update to latest LTS version for better performance',
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    user_id: 'user-editor-001',
    session_id: 'session-002',
  },
  {
    id: 'suggestion-002',
    doc_path: 'docs/PRD.md',
    line_start: 50,
    line_end: 52,
    original_text: 'Support 5+ AI providers',
    suggested_text: 'Support 8+ AI providers including local LLMs',
    description: 'Expand AI provider support to include local models',
    status: 'accepted',
    reviewed_by: 'user-admin-001',
    reviewed_at: now - 86400000,
    user_id: 'user-reviewer-001',
    session_id: 'session-001',
  },
];

const suggestionsSql = suggestions.map(s =>
  `INSERT INTO suggestions (id, doc_path, line_start, line_end, original_text, suggested_text, description, status, reviewed_by, reviewed_at, user_id, session_id, created_at, updated_at)
   VALUES ('${s.id}', '${s.doc_path}', ${s.line_start}, ${s.line_end}, '${s.original_text}', '${s.suggested_text}', '${s.description}', '${s.status}', ${s.reviewed_by ? `'${s.reviewed_by}'` : 'NULL'}, ${s.reviewed_at || 'NULL'}, '${s.user_id}', '${s.session_id}', ${now}, ${now});`
).join('\n');

executeSql(suggestionsSql, 'Creating sample suggestions');

// 6. Sample Discussions
const discussions = [
  {
    id: 'discussion-001',
    doc_path: 'docs/architecture.md',
    title: 'Event Sourcing vs CQRS',
    description: 'Should we implement full CQRS pattern or just event sourcing?',
    status: 'open',
    user_id: 'user-admin-001',
    session_id: 'session-002',
  },
  {
    id: 'discussion-002',
    doc_path: 'docs/epics.md',
    title: 'Epic Prioritization',
    description: 'Discussion on which epics to prioritize after Epic 1',
    status: 'closed',
    user_id: 'user-editor-001',
    session_id: 'session-001',
  },
];

const discussionsSql = discussions.map(d =>
  `INSERT INTO discussions (id, doc_path, title, description, status, user_id, session_id, created_at, updated_at)
   VALUES ('${d.id}', '${d.doc_path}', '${d.title}', '${d.description}', '${d.status}', '${d.user_id}', '${d.session_id}', ${now}, ${now});`
).join('\n');

executeSql(discussionsSql, 'Creating sample discussions');

// 7. Sample Discussion Messages
const messages = [
  {
    id: 'message-001',
    discussion_id: 'discussion-001',
    content: 'I think full CQRS might be overkill for our current scale.',
    user_id: 'user-reviewer-001',
  },
  {
    id: 'message-002',
    discussion_id: 'discussion-001',
    content: 'Agreed. Let us start with event sourcing and add CQRS later if needed.',
    user_id: 'user-admin-001',
  },
  {
    id: 'message-003',
    discussion_id: 'discussion-002',
    content: 'Epic 2 (autonomous workflow) should be next to validate the core concept.',
    user_id: 'user-editor-001',
  },
];

const messagesSql = messages.map(m =>
  `INSERT INTO discussion_messages (id, discussion_id, content, user_id, created_at, updated_at)
   VALUES ('${m.id}', '${m.discussion_id}', '${m.content}', '${m.user_id}', ${now}, ${now});`
).join('\n');

executeSql(messagesSql, 'Creating sample discussion messages');

// 8. Sample Activity Log
const activities = [
  {
    id: 'activity-001',
    user_id: 'user-admin-001',
    action: 'COMMENT_CREATED',
    resource_type: 'comment',
    resource_id: 'comment-001',
    metadata: JSON.stringify({ doc_path: 'docs/architecture.md' }),
  },
  {
    id: 'activity-002',
    user_id: 'user-editor-001',
    action: 'SUGGESTION_CREATED',
    resource_type: 'suggestion',
    resource_id: 'suggestion-001',
    metadata: JSON.stringify({ doc_path: 'docs/architecture.md', session_id: 'session-002' }),
  },
  {
    id: 'activity-003',
    user_id: 'user-admin-001',
    action: 'SUGGESTION_ACCEPTED',
    resource_type: 'suggestion',
    resource_id: 'suggestion-002',
    metadata: JSON.stringify({ doc_path: 'docs/PRD.md', session_id: 'session-001' }),
  },
];

const activitiesSql = activities.map(a =>
  `INSERT INTO activity_log (id, user_id, action, resource_type, resource_id, metadata, created_at)
   VALUES ('${a.id}', '${a.user_id}', '${a.action}', '${a.resource_type}', '${a.resource_id}', '${a.metadata}', ${now});`
).join('\n');

executeSql(activitiesSql, 'Creating sample activity log entries');

console.log('🎉 Database seeding completed successfully!\n');
console.log('📊 Seed Summary:');
console.log(`   - Users: ${users.length}`);
console.log(`   - Documents: ${documents.length}`);
console.log(`   - Review Sessions: ${sessions.length}`);
console.log(`   - Comments: ${comments.length}`);
console.log(`   - Suggestions: ${suggestions.length}`);
console.log(`   - Discussions: ${discussions.length}`);
console.log(`   - Discussion Messages: ${messages.length}`);
console.log(`   - Activity Log Entries: ${activities.length}`);
console.log('\n✅ You can now test search, comments, suggestions, and other features!');
