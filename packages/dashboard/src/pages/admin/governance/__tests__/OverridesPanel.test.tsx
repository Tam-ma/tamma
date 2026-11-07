// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OverridesPanel,
  automatedAt,
  destructiveLoweredByGroup,
  destructiveLoweredByGroupClear,
  destructiveLoweredByReset,
} from '../OverridesPanel.js';
import type {
  ActionPolicyResponse,
  PolicyAction,
} from '../../../../services/admin/actions-policy-api-client.js';

const mockGetPolicy = vi.fn();
const mockSetActionThreshold = vi.fn();
const mockSetActionEnforce = vi.fn();
const mockSetActionEnabled = vi.fn();
const mockDeleteActionOverride = vi.fn();
const mockSetGroupThreshold = vi.fn();
const mockDeleteGroupOverride = vi.fn();
const mockResetPolicy = vi.fn();

vi.mock('../../../../services/admin/actions-policy-api-client.js', () => ({
  actionsPolicyApi: {
    getPolicy: (...args: unknown[]) => mockGetPolicy(...args),
    setActionThreshold: (...args: unknown[]) => mockSetActionThreshold(...args),
    setActionEnforce: (...args: unknown[]) => mockSetActionEnforce(...args),
    setActionEnabled: (...args: unknown[]) => mockSetActionEnabled(...args),
    deleteActionOverride: (...args: unknown[]) => mockDeleteActionOverride(...args),
    setGroupThreshold: (...args: unknown[]) => mockSetGroupThreshold(...args),
    deleteGroupOverride: (...args: unknown[]) => mockDeleteGroupOverride(...args),
    resetPolicy: (...args: unknown[]) => mockResetPolicy(...args),
  },
}));

function makePolicyAction(overrides?: Partial<PolicyAction>): PolicyAction {
  return {
    key: 'scw:pr.merge',
    group: 'source-control-write',
    risk: 'high',
    title: 'Merge a pull request',
    summary: 'Merges a PR into its base branch.',
    siteKey: 'pr.merge',
    minAutonomy: 90,
    source: 'system-default',
    enforce: true,
    enabled: true,
    allowedRoles: null,
    escalatableToHuman: true,
    enforceable: true,
    isMachinery: false,
    shippedLevel: 90,
    ladderWithoutRow: 90,
    automatedAtLevel: false,
    levelOwned: false,
    editable: true,
    reason: 'editable',
    toggleAboveDial: false,
    enforcementSites: ['route: POST /api/engine/pr-merge'],
    ...overrides,
  };
}

function makePolicy(): ActionPolicyResponse {
  return {
    dial: { min: 1, max: 100, alwaysHuman: 101, default: 70, current: 70, viewLevel: 70 },
    groups: [
      {
        group: 'source-control-write',
        description: 'Writing to source control.',
        members: 2,
        principalRow: null,
        platformRow: null,
      },
      {
        group: 'docs',
        description: 'Human-readable prose.',
        members: 1,
        principalRow: { minAutonomy: 60, enforce: null, enabled: null, allowedRoles: null },
        platformRow: null,
      },
    ],
    actions: [
      makePolicyAction(),
      makePolicyAction({
        key: 'scw:branch.push',
        title: 'Push a branch',
        source: 'action-override',
        minAutonomy: 1,
        automatedAtLevel: true,
      }),
    ],
  };
}

function setup() {
  mockGetPolicy.mockResolvedValue(makePolicy());
  mockSetGroupThreshold.mockResolvedValue({ group: 'source-control-write', minAutonomy: 95 });
  mockDeleteGroupOverride.mockResolvedValue({ message: 'gone' });
  mockSetActionThreshold.mockResolvedValue({ key: 'scw:pr.merge', minAutonomy: 1, dialAtMint: 70 });
  mockSetActionEnabled.mockResolvedValue({ key: 'scw:pr.merge', field: 'enabled', value: false });
  mockSetActionEnforce.mockResolvedValue({ key: 'scw:pr.merge', field: 'enforce', value: false });
  mockDeleteActionOverride.mockResolvedValue({
    message: 'gone',
    nowResolvesTo: 90,
    source: 'shipped',
    reason: 'the next tier applies',
  });
  mockResetPolicy.mockResolvedValue({ removed: 2 });
}

describe('OverridesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error banner with retry when the policy read fails', async () => {
    mockGetPolicy.mockRejectedValue(new Error('boom'));
    render(<OverridesPanel />);
    expect(await screen.findByText('Failed to load the policy')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('renders groups and actions with provenance badges', async () => {
    setup();
    render(<OverridesPanel />);

    expect(await screen.findByTestId('group-row-source-control-write')).toBeInTheDocument();
    // docs carries a stored group row → its override value shows.
    expect(screen.getByTestId('group-row-docs')).toHaveTextContent('60');
    expect(screen.getByTestId('override-source-scw:pr.merge')).toHaveTextContent('Default');
    expect(screen.getByTestId('override-source-scw:branch.push')).toHaveTextContent(
      'Action override',
    );
  });

  it('sets a group threshold through PUT and reloads', async () => {
    setup();
    render(<OverridesPanel />);

    const input = await screen.findByLabelText('Threshold for source-control-write');
    await userEvent.type(input, '95');
    const row = screen.getByTestId('group-row-source-control-write');
    await userEvent.click(row.querySelector('button')!);

    await waitFor(() =>
      expect(mockSetGroupThreshold).toHaveBeenCalledWith('source-control-write', 95),
    );
    // One load on mount + one reload after the write.
    await waitFor(() => expect(mockGetPolicy).toHaveBeenCalledTimes(2));
  });

  it('clears a stored group row through DELETE', async () => {
    setup();
    render(<OverridesPanel />);

    await screen.findByTestId('group-row-docs');
    await userEvent.click(screen.getByText('Clear'));

    await waitFor(() => expect(mockDeleteGroupOverride).toHaveBeenCalledWith('docs'));
  });

  it('forces an action on with the server-reported minimum (no client arithmetic)', async () => {
    setup();
    render(<OverridesPanel />);

    await userEvent.click(await screen.findByLabelText('Force scw:pr.merge on'));

    // The value sent is the /policy dial minimum the server returned (1 here).
    await waitFor(() =>
      expect(mockSetActionThreshold).toHaveBeenCalledWith('scw:pr.merge', 1),
    );
  });

  it('toggles enabled through PUT', async () => {
    setup();
    render(<OverridesPanel />);

    await userEvent.click(await screen.findByLabelText('Disable scw:pr.merge'));

    await waitFor(() => expect(mockSetActionEnabled).toHaveBeenCalledWith('scw:pr.merge', false));
  });

  it('removes an action override through DELETE', async () => {
    setup();
    render(<OverridesPanel />);

    await userEvent.click(await screen.findByLabelText('Remove override for scw:branch.push'));

    await waitFor(() =>
      expect(mockDeleteActionOverride).toHaveBeenCalledWith('scw:branch.push'),
    );
  });

  it('reset-all requires a confirm and then POSTs the reset', async () => {
    setup();
    render(<OverridesPanel />);

    await userEvent.click(await screen.findByText('Reset all overrides'));
    // Nothing sent yet — the confirm step is in the way.
    expect(mockResetPolicy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Yes, remove all'));
    await waitFor(() => expect(mockResetPolicy).toHaveBeenCalledTimes(1));
  });

  it('cancelling the reset confirm sends nothing', async () => {
    setup();
    render(<OverridesPanel />);

    await userEvent.click(await screen.findByText('Reset all overrides'));
    await userEvent.click(screen.getByText('Cancel'));

    expect(mockResetPolicy).not.toHaveBeenCalled();
    expect(screen.getByText('Reset all overrides')).toBeInTheDocument();
  });

  it('surfaces a failed write as an alert without losing the table', async () => {
    setup();
    mockSetActionEnabled.mockRejectedValue(new Error('member role may not edit policy'));
    render(<OverridesPanel />);

    await userEvent.click(await screen.findByLabelText('Disable scw:pr.merge'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'member role may not edit policy',
    );
    expect(screen.getByTestId('override-row-scw:pr.merge')).toBeInTheDocument();
  });

  // ── Story 43-7 (re-scoped): not-enforced badge, destructive confirm, level preview ──

  describe('story 43-7', () => {
    const destructive = (overrides?: Partial<PolicyAction>) =>
      makePolicyAction({
        key: 'deploy:prod',
        group: 'deploy-control',
        risk: 'destructive',
        title: 'Deploy to production',
        minAutonomy: 95,
        ...overrides,
      });

    function withActions(...actions: PolicyAction[]) {
      withGroupRow(null, ...actions);
    }

    function withGroupRow(
      principalRow: ActionPolicyResponse['groups'][number]['principalRow'],
      ...actions: PolicyAction[]
    ) {
      const policy = makePolicy();
      policy.actions = actions;
      policy.groups = [
        { group: 'deploy-control', description: 'Deploys.', members: actions.length, principalRow, platformRow: null },
      ];
      mockGetPolicy.mockResolvedValue(policy);
    }

    it('zero_enforcement_sites_renders_not_enforced_badge', async () => {
      withActions(destructive({ enforcementSites: [] }), makePolicyAction());
      render(<OverridesPanel />);

      expect(await screen.findByTestId('not-enforced-deploy:prod')).toBeInTheDocument();
      expect(screen.queryByTestId('not-enforced-scw:pr.merge')).not.toBeInTheDocument();
    });

    it('lowering_destructive_threshold_requires_confirm (force on)', async () => {
      withActions(destructive());
      const user = userEvent.setup();
      render(<OverridesPanel />);

      await user.click(await screen.findByRole('button', { name: 'Force deploy:prod on' }));
      expect(mockSetActionThreshold).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog')).toHaveTextContent('destructive');

      await user.click(screen.getByRole('button', { name: 'Yes, continue' }));
      await waitFor(() => expect(mockSetActionThreshold).toHaveBeenCalledWith('deploy:prod', 1));
    });

    it('cancelling the confirm writes nothing', async () => {
      withActions(destructive());
      const user = userEvent.setup();
      render(<OverridesPanel />);

      await user.click(await screen.findByRole('button', { name: 'Stop enforcing deploy:prod' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockSetActionEnforce).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('a non-destructive change needs no confirm', async () => {
      withActions(makePolicyAction());
      const user = userEvent.setup();
      render(<OverridesPanel />);

      await user.click(await screen.findByRole('button', { name: 'Force scw:pr.merge on' }));
      await waitFor(() => expect(mockSetActionThreshold).toHaveBeenCalledWith('scw:pr.merge', 1));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('a group threshold that lowers a destructive member asks first, naming it', async () => {
      withActions(destructive());
      const user = userEvent.setup();
      render(<OverridesPanel />);

      const input = await screen.findByLabelText('Threshold for deploy-control');
      await user.clear(input);
      await user.type(input, '50');
      await user.click(screen.getByRole('button', { name: 'Set' }));

      expect(mockSetGroupThreshold).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog')).toHaveTextContent('deploy:prod');
      await user.click(screen.getByRole('button', { name: 'Yes, continue' }));
      await waitFor(() => expect(mockSetGroupThreshold).toHaveBeenCalledWith('deploy-control', 50));
    });

    it('destructiveLoweredByGroup ignores action overrides, higher values and other groups', () => {
      const actions = [
        destructive(),
        destructive({ key: 'deploy:pinned', source: 'action-override' }),
        destructive({ key: 'deploy:low', minAutonomy: 40 }),
        destructive({ key: 'other:x', group: 'secrets' }),
        makePolicyAction({ group: 'deploy-control' }),
      ];
      expect(destructiveLoweredByGroup(actions, 'deploy-control', 50).map((a) => a.key)).toEqual(['deploy:prod']);
      expect(destructiveLoweredByGroup(actions, 'deploy-control', 99)).toEqual([]);
    });

    it('level_preview_does_not_issue_a_write and dims rows from data already held', async () => {
      withActions(destructive(), makePolicyAction({ key: 'scw:low', minAutonomy: 60 }));
      render(<OverridesPanel />);

      const slider = await screen.findByLabelText('Preview level');
      expect(slider).toHaveAttribute('min', '1');
      expect(slider).toHaveAttribute('max', '100');
      expect(screen.getByTestId('override-row-scw:low')).not.toHaveAttribute('data-automated-at-preview');

      fireEvent.change(slider, { target: { value: '80' } });

      expect(screen.getByTestId('preview-level')).toHaveTextContent('80');
      expect(screen.getByTestId('override-row-scw:low')).toHaveAttribute('data-automated-at-preview', 'true');
      expect(screen.getByTestId('override-row-deploy:prod')).not.toHaveAttribute('data-automated-at-preview');
      expect(mockGetPolicy).toHaveBeenCalledTimes(1);
      expect(mockSetActionThreshold).not.toHaveBeenCalled();
      expect(mockSetGroupThreshold).not.toHaveBeenCalled();
      // The dimmed row's controls still work (the greyed-row contract).
      expect(screen.getByRole('button', { name: 'Force scw:low on' })).toBeEnabled();
    });

    // ── AC11 follow-up: enable, group clear and reset-all also lower protection ──

    it('enabling a disabled destructive action asks first, naming it', async () => {
      withActions(destructive({ enabled: false }));
      const user = userEvent.setup();
      render(<OverridesPanel />);

      await user.click(await screen.findByRole('button', { name: 'Enable deploy:prod' }));
      expect(mockSetActionEnabled).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog')).toHaveTextContent('deploy:prod');

      await user.click(screen.getByRole('button', { name: 'Yes, continue' }));
      await waitFor(() => expect(mockSetActionEnabled).toHaveBeenCalledWith('deploy:prod', true));
    });

    it('disabling a destructive action, or enabling an advisory one, needs no confirm', async () => {
      withActions(destructive(), destructive({ key: 'deploy:advisory', enabled: false, enforce: false }));
      const user = userEvent.setup();
      render(<OverridesPanel />);

      await user.click(await screen.findByRole('button', { name: 'Disable deploy:prod' }));
      await waitFor(() => expect(mockSetActionEnabled).toHaveBeenCalledWith('deploy:prod', false));
      await user.click(screen.getByRole('button', { name: 'Enable deploy:advisory' }));
      await waitFor(() => expect(mockSetActionEnabled).toHaveBeenCalledWith('deploy:advisory', true));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('clearing a group row above a destructive member asks first, naming it', async () => {
      withGroupRow(
        { minAutonomy: 98, enforce: null, enabled: null, allowedRoles: null },
        destructive({ source: 'group-override', minAutonomy: 98, shippedLevel: 95 }),
      );
      const user = userEvent.setup();
      render(<OverridesPanel />);

      await user.click(await screen.findByRole('button', { name: 'Clear' }));
      expect(mockDeleteGroupOverride).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog')).toHaveTextContent('deploy:prod');

      await user.click(screen.getByRole('button', { name: 'Yes, continue' }));
      await waitFor(() => expect(mockDeleteGroupOverride).toHaveBeenCalledWith('deploy-control'));
    });

    it('clearing a group row that only lowers non-destructive members needs no confirm', async () => {
      withGroupRow(
        { minAutonomy: 40, enforce: null, enabled: null, allowedRoles: null },
        // The group row sits BELOW the destructive member's shipped level, so removing it raises it.
        destructive({ source: 'system-default', minAutonomy: 95, shippedLevel: 95 }),
      );
      const user = userEvent.setup();
      render(<OverridesPanel />);

      await user.click(await screen.findByRole('button', { name: 'Clear' }));
      await waitFor(() => expect(mockDeleteGroupOverride).toHaveBeenCalledWith('deploy-control'));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('destructiveLoweredByGroupClear covers raised thresholds and group-row disables only', () => {
      const actions = [
        destructive({ source: 'group-override', minAutonomy: 98, shippedLevel: 95 }),
        destructive({ key: 'deploy:same', source: 'group-override', minAutonomy: 95, shippedLevel: 95 }),
        destructive({ key: 'deploy:pinned', source: 'action-override', minAutonomy: 99, shippedLevel: 95 }),
        destructive({ key: 'deploy:off', enabled: false }),
        destructive({ key: 'other:x', group: 'secrets', source: 'group-override', minAutonomy: 98 }),
        makePolicyAction({ group: 'deploy-control', source: 'group-override', minAutonomy: 98 }),
      ];
      expect(destructiveLoweredByGroupClear(actions, 'deploy-control', false).map((a) => a.key)).toEqual([
        'deploy:prod',
      ]);
      expect(destructiveLoweredByGroupClear(actions, 'deploy-control', true).map((a) => a.key)).toEqual([
        'deploy:prod',
        'deploy:off',
      ]);
    });

    it('reset-all names the destructive actions it un-gates', async () => {
      withActions(
        destructive({ source: 'action-override', minAutonomy: 99, shippedLevel: 95 }),
        destructive({ key: 'deploy:off', enabled: false }),
        destructive({ key: 'deploy:forced', source: 'action-override', minAutonomy: 1, shippedLevel: 95 }),
      );
      const user = userEvent.setup();
      render(<OverridesPanel />);

      await user.click(await screen.findByText('Reset all overrides'));
      const confirm = screen.getByTestId('reset-confirm');
      expect(confirm).toHaveTextContent('lowers protection on destructive action(s): deploy:prod, deploy:off.');
      expect(confirm).not.toHaveTextContent('deploy:forced');
      expect(mockResetPolicy).not.toHaveBeenCalled();
    });

    it('reset-all with nothing destructive to un-gate keeps the plain confirm', async () => {
      setup();
      render(<OverridesPanel />);

      await userEvent.click(await screen.findByText('Reset all overrides'));
      expect(screen.getByTestId('reset-confirm')).toHaveTextContent(/^Remove every stored override\?$/);
      expect(destructiveLoweredByReset(makePolicy().actions)).toEqual([]);
    });

    // ── Preview must match the gate: disabled denies, advisory never blocks ──

    it('automatedAt: disabled is never automated, advisory always is', () => {
      expect(automatedAt(makePolicyAction({ minAutonomy: 60 }), 80)).toBe(true);
      expect(automatedAt(makePolicyAction({ minAutonomy: 60 }), 50)).toBe(false);
      expect(automatedAt(makePolicyAction({ minAutonomy: 60, enabled: false }), 100)).toBe(false);
      expect(automatedAt(makePolicyAction({ minAutonomy: 101, enforce: false }), 1)).toBe(true);
    });

    it('the preview does not dim a disabled action whose level is reached', async () => {
      withActions(makePolicyAction({ key: 'scw:off', minAutonomy: 60, enabled: false }));
      render(<OverridesPanel />);

      fireEvent.change(await screen.findByLabelText('Preview level'), { target: { value: '80' } });
      expect(screen.getByTestId('preview-level')).toHaveTextContent('80');
      expect(screen.getByTestId('override-row-scw:off')).not.toHaveAttribute('data-automated-at-preview');
    });
  });
});
