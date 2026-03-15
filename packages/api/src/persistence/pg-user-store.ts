import type pg from 'pg';
import type { IUserStore, User, UserInstallation } from './user-store.js';

/** PostgreSQL-backed user store. */
export class PgUserStore implements IUserStore {
  constructor(private readonly pool: pg.Pool) {}

  async upsertUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO users (github_id, github_login, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (github_id)
       DO UPDATE SET github_login = $2, email = COALESCE($3, users.email), updated_at = NOW()
       RETURNING *`,
      [user.githubId, user.githubLogin, user.email, user.role],
    );
    return this.mapUser(result.rows[0]!);
  }

  async getUser(id: string): Promise<User | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM users WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]!);
  }

  async getUserByGithubId(githubId: number): Promise<User | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM users WHERE github_id = $1',
      [githubId],
    );
    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]!);
  }

  async linkUserToInstallation(userId: string, installationId: number, role: 'owner' | 'admin' | 'member'): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_installations (user_id, installation_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, installation_id)
       DO UPDATE SET role = $3`,
      [userId, installationId, role],
    );
  }

  async getUserInstallations(userId: string): Promise<UserInstallation[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM user_installations WHERE user_id = $1',
      [userId],
    );
    return result.rows.map((r) => ({
      userId: String(r['user_id']),
      installationId: Number(r['installation_id']),
      role: String(r['role']) as 'owner' | 'admin' | 'member',
      createdAt: String(r['created_at']),
    }));
  }

  private mapUser(row: Record<string, unknown>): User {
    return {
      id: String(row['id']),
      githubId: Number(row['github_id']),
      githubLogin: String(row['github_login']),
      email: row['email'] !== null && row['email'] !== undefined ? String(row['email']) : null,
      role: String(row['role']) as 'owner' | 'admin' | 'member',
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    };
  }
}
