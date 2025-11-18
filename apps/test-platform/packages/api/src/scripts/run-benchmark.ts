#!/usr/bin/env tsx

/**
 * Benchmark CLI Runner
 * Run benchmarks from the command line
 *
 * Usage:
 *   npm run benchmark -- --model=claude-3-5-sonnet --difficulty=easy --limit=5
 *   npm run benchmark -- --config=./benchmark-config.json
 */

import { BenchmarkRunner } from '../services/benchmark'
import type { BenchmarkRunConfig, ModelConfig } from '../services/benchmark/types'
import { readFileSync } from 'fs'

async function main() {
  const args = process.argv.slice(2)

  let config: BenchmarkRunConfig

  // Check if config file provided
  const configArg = args.find((arg) => arg.startsWith('--config='))
  if (configArg) {
    const configPath = configArg.split('=')[1]
    const configFile = readFileSync(configPath, 'utf-8')
    config = JSON.parse(configFile)
  } else {
    // Parse CLI arguments
    config = parseCliArgs(args)
  }

  console.log('\n🎯 Benchmark Configuration:')
  console.log(JSON.stringify(config, null, 2))
  console.log('\n')

  // Run benchmark
  const runner = new BenchmarkRunner()
  const result = await runner.run(config)

  console.log(`\n✅ Benchmark complete! Results ID: ${result.runId}`)
  process.exit(0)
}

function parseCliArgs(args: string[]): BenchmarkRunConfig {
  const getArg = (name: string): string | undefined => {
    const arg = args.find((a) => a.startsWith(`--${name}=`))
    return arg?.split('=')[1]
  }

  const hasFlag = (name: string): boolean => {
    return args.includes(`--${name}`)
  }

  // Parse model configuration
  const provider = (getArg('provider') as any) || 'anthropic'
  const model = getArg('model') || 'claude-3-5-sonnet-20241022'
  const apiKey = getArg('api-key') || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY

  if (!apiKey) {
    console.error('❌ Error: API key required. Set ANTHROPIC_API_KEY or OPENAI_API_KEY env var, or use --api-key flag')
    process.exit(1)
  }

  const modelConfig: ModelConfig = {
    provider,
    model,
    apiKey,
    temperature: parseFloat(getArg('temperature') || '0.7'),
    maxTokens: parseInt(getArg('max-tokens') || '4096'),
  }

  // Parse task selection
  const language = getArg('language') || 'typescript'
  const scenario = getArg('scenario') || 'code-generation'
  const difficulty = getArg('difficulty') as any
  const limit = parseInt(getArg('limit') || '10')

  // Parse execution settings
  const parallel = hasFlag('parallel')
  const maxConcurrency = parseInt(getArg('concurrency') || '3')
  const timeout = parseInt(getArg('timeout') || '60000')
  const verbose = hasFlag('verbose')

  return {
    name: getArg('name') || `Benchmark ${new Date().toISOString()}`,
    description: getArg('description'),
    language,
    scenario,
    difficulty: difficulty ? (difficulty.split(',') as any) : undefined,
    limit,
    models: [modelConfig],
    parallel,
    maxConcurrency,
    timeout,
    saveResults: true,
    outputPath: getArg('output'),
    verbose,
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error)
  process.exit(1)
})

// Run
main().catch((error) => {
  console.error('❌ Benchmark failed:', error)
  process.exit(1)
})
