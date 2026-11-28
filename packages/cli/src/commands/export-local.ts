import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export interface ExportLocalOptions {
  output?: string;
  signingKeyFile?: string;
  apiProject?: string;
  force?: boolean;
  verify?: string;
  trustedKeyFile?: string;
  runner?: LocalExportRunner;
}

export type LocalExportRunner = (command: string, args: string[]) => Promise<number>;

export async function exportLocalCommand(options: ExportLocalOptions): Promise<number> {
  try {
    const project = resolveApiProject(options.apiProject);
    const commandArgs = ['run', '--project', project, '--no-launch-profile', '--'];
    if (options.verify !== undefined) {
      if (options.trustedKeyFile === undefined || options.trustedKeyFile.length === 0) {
        console.error('export-local: --trusted-key-file is required with --verify.');
        return 1;
      }
      commandArgs.push(
        'verify-local-export',
        '--archive',
        path.resolve(options.verify),
        '--trusted-key-file',
        path.resolve(options.trustedKeyFile)
      );
    } else {
      const keyFile = options.signingKeyFile ?? process.env['TAMMA_LOCAL_EXPORT_SIGNING_KEY_FILE'];
      if (keyFile === undefined || keyFile.length === 0) {
        console.error(
          'export-local: set --signing-key-file or TAMMA_LOCAL_EXPORT_SIGNING_KEY_FILE.'
        );
        return 1;
      }
      commandArgs.push(
        'export-local',
        '--output',
        path.resolve(options.output ?? 'tamma-local-export-v1.tar.gz'),
        '--signing-key-file',
        path.resolve(keyFile)
      );
      if (options.force === true) commandArgs.push('--force');
    }
    return await (options.runner ?? runDotnet)('dotnet', commandArgs);
  } catch {
    console.error('export-local: FAILED. No archive was published.');
    return 1;
  }
}

function resolveApiProject(override: string | undefined): string {
  const configured = override ?? process.env['TAMMA_API_PROJECT'];
  if (configured !== undefined && configured.length > 0) return path.resolve(configured);
  const relative = path.join('apps', 'tamma-elsa', 'src', 'Tamma.Api', 'Tamma.Api.csproj');
  const candidates = [
    path.resolve(process.cwd(), relative),
    path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)), relative),
  ];
  const project = candidates.find((candidate) => existsSync(candidate));
  if (project === undefined) {
    throw new Error('Tamma.Api project not found');
  }
  return project;
}

async function runDotnet(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}
