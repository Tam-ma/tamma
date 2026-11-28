import { dispatch } from './dispatch.js';
import { serve } from './service.js';

try {
  switch (process.argv[2]) {
    case 'service':
      await serve();
      break;
    case 'process-issue':
      process.exitCode = await dispatch();
      break;
    default:
      throw new Error('Unknown worker command');
  }
} catch {
  console.error('Worker startup failed. Check command and configuration.');
  process.exitCode = 1;
}
