import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenvConfig({
  path: path.resolve(__dirname, '.env'),
});

// Import environment configs
import localConfig from './playwright/config/local.config.js';

// Central environment config map
const envConfigMap = {
  local: localConfig,
};

const environment = process.env.TEST_ENV || 'local';

// Fail fast if environment not supported
if (!Object.keys(envConfigMap).includes(environment)) {
  console.error(`❌ No configuration found for environment: ${environment}`);
  console.error(`   Available environments: ${Object.keys(envConfigMap).join(', ')}`);
  process.exit(1);
}

console.log(`✅ Running E2E tests against: ${environment.toUpperCase()}`);

export default envConfigMap[environment as keyof typeof envConfigMap];
