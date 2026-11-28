import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exportLocalCommand, type LocalExportRunner } from './export-local.js';

function fixture(): { directory: string; project: string; key: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tamma-export-cli-'));
  const project = path.join(directory, 'Tamma.Api.csproj');
  const key = path.join(directory, 'signing-key');
  fs.writeFileSync(project, '<Project />');
  fs.writeFileSync(key, 'not-read-by-the-cli');
  return { directory, project, key };
}

describe('export-local command', () => {
  it('delegates export to the offline .NET command with safe file arguments', async () => {
    const { directory, project, key } = fixture();
    try {
      const runner = vi.fn<LocalExportRunner>().mockResolvedValue(0);
      const output = path.join(directory, 'export.tar.gz');
      const result = await exportLocalCommand({
        apiProject: project,
        signingKeyFile: key,
        output,
        force: true,
        runner,
      });

      expect(result).toBe(0);
      expect(runner).toHaveBeenCalledOnce();
      const [command, args] = runner.mock.calls[0]!;
      expect(command).toBe('dotnet');
      expect(args.slice(0, 4)).toEqual(['run', '--project', project, '--no-launch-profile']);
      expect(args).toContain('export-local');
      expect(args).toContain(path.resolve(output));
      expect(args).toContain(path.resolve(key));
      expect(args).toContain('--force');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('dispatches verification without reading a signing key', async () => {
    const { directory, project } = fixture();
    try {
      const runner = vi.fn<LocalExportRunner>().mockResolvedValue(0);
      const archive = path.join(directory, 'export.tar.gz');
      const trust = path.join(directory, 'trusted-public-key');
      const result = await exportLocalCommand({
        apiProject: project,
        verify: archive,
        trustedKeyFile: trust,
        runner,
      });

      expect(result).toBe(0);
      const args = runner.mock.calls[0]![1];
      expect(args).toContain('verify-local-export');
      expect(args).toContain(path.resolve(archive));
      expect(args).toContain(path.resolve(trust));
      expect(args).not.toContain('export-local');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires a signing key file without spawning a process', async () => {
    const { directory, project } = fixture();
    try {
      const runner = vi.fn<LocalExportRunner>();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const previous = process.env['TAMMA_LOCAL_EXPORT_SIGNING_KEY_FILE'];
      delete process.env['TAMMA_LOCAL_EXPORT_SIGNING_KEY_FILE'];
      try {
        expect(await exportLocalCommand({ apiProject: project, runner })).toBe(1);
        expect(runner).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('--signing-key-file'));
      } finally {
        error.mockRestore();
        if (previous !== undefined) process.env['TAMMA_LOCAL_EXPORT_SIGNING_KEY_FILE'] = previous;
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
