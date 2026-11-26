// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessAdminPage } from '../AccessAdminPage.js';
import { accessApi } from '../../../../services/admin/access-api-client.js';

const mockUseCurrentUser = vi.fn();
vi.mock('../../../../hooks/admin/useCurrentUser.js', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

describe('AccessAdminPage (Story 39-20 AC2 UI)', () => {
  beforeEach(() => {
    mockUseCurrentUser.mockReturnValue({ isAdmin: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders teams + repo tabs, updates visibility via PUT, and saves grants via PUT', async () => {
    const user = userEvent.setup();
    vi.spyOn(accessApi, 'listTeams').mockResolvedValue([
      {
        id: 'team-1',
        tenantId: 'tenant-1',
        name: 'Platform',
        description: null,
        defaultMemberRole: 'member',
        memberCount: 2,
        members: [],
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ]);
    vi.spyOn(accessApi, 'listRepos').mockResolvedValue([
      {
        id: 'repo-1',
        tenantId: 'tenant-1',
        platformKind: 'github',
        repoFullName: 'acme/api',
        externalId: '101',
        visibility: 'tenant',
        effectiveAccessLevel: 'admin',
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ]);
    vi.spyOn(accessApi, 'listGrants').mockResolvedValue([]);
    const visSpy = vi.spyOn(accessApi, 'updateRepoVisibility').mockResolvedValue({
      id: 'repo-1',
      tenantId: 'tenant-1',
      platformKind: 'github',
      repoFullName: 'acme/api',
      externalId: '101',
      visibility: 'restricted',
      effectiveAccessLevel: 'admin',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });
    const grantSpy = vi.spyOn(accessApi, 'upsertGrant').mockResolvedValue({
      id: 'grant-1',
      repositoryId: 'repo-1',
      userId: null,
      teamId: 'team-1',
      accessLevel: 'contribute',
      createdBy: 'admin-1',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });

    render(<AccessAdminPage tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByText('Platform')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /Repo Access/i }));
    await waitFor(() => {
      expect(screen.getByText('acme/api')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Visibility for acme/api'), 'restricted');
    expect(visSpy).toHaveBeenCalledWith('tenant-1', 'repo-1', 'restricted');

    await user.click(screen.getByRole('button', { name: 'Manage Grants' }));
    await waitFor(() => {
      expect(screen.getByTestId('repo-grants-panel-repo-1')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Grantee ID'), 'team-1');
    await user.click(screen.getByRole('button', { name: 'Save Grant' }));

    expect(grantSpy).toHaveBeenCalledWith('tenant-1', 'repo-1', {
      userId: null,
      teamId: 'team-1',
      accessLevel: 'contribute',
    });
  });

  it('hides admin write controls when caller is not an admin', async () => {
    mockUseCurrentUser.mockReturnValue({ isAdmin: false });
    vi.spyOn(accessApi, 'listTeams').mockResolvedValue([]);
    vi.spyOn(accessApi, 'listRepos').mockResolvedValue([]);

    render(<AccessAdminPage tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByText(/No teams created yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('create-team-form')).not.toBeInTheDocument();
  });
});
