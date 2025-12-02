/**
 * Seed script for Test Bank
 * Populates the database with initial benchmark tasks
 */

import { db } from '../index'
import { testBank } from '../schema'
import { typescriptCodeGenEasyTasks } from './test-bank-ts-codegen-easy'
import { typescriptCodeGenMediumTasks } from './test-bank-ts-codegen-medium'
import { typescriptCodeGenHardTasks } from './test-bank-ts-codegen-hard'
import { pythonCodeGenEasyTasks } from './test-bank-python-codegen-easy'
import { nanoid } from 'nanoid'

async function seedTestBank() {
  console.log('🌱 Seeding test bank...')

  // Combine all task sets
  const allTasks = [
    ...typescriptCodeGenEasyTasks,
    ...typescriptCodeGenMediumTasks,
    ...typescriptCodeGenHardTasks,
    ...pythonCodeGenEasyTasks,
  ]

  const tasksToInsert = allTasks.map((task) => ({
    id: nanoid(),
    language: task.language,
    scenario: task.scenario,
    difficulty: task.difficulty,
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    starterCode: task.starterCode || null,
    solution: task.solution,
    testSuite: JSON.stringify(task.testSuite),
    expectedMetrics: task.expectedMetrics ? JSON.stringify(task.expectedMetrics) : null,
    primaryRole: task.primaryRole,
    roleEvaluations: task.roleEvaluations ? JSON.stringify(task.roleEvaluations) : null,
    createdBy: task.createdBy || null,
    tags: task.tags ? JSON.stringify(task.tags) : null,
    source: task.source || null,
  }))

  try {
    await db.insert(testBank).values(tasksToInsert)
    console.log(`✅ Successfully seeded ${tasksToInsert.length} tasks`)
    console.log('   - TypeScript Code Generation (Easy): 50 tasks')
    console.log('   - TypeScript Code Generation (Medium): 50 tasks')
    console.log('   - TypeScript Code Generation (Hard): 50 tasks')
    console.log(`   - Python Code Generation (Easy): ${pythonCodeGenEasyTasks.length} tasks`)
    console.log(`\n📊 Total: ${tasksToInsert.length} tasks across all languages and difficulty levels`)
  } catch (error) {
    console.error('❌ Error seeding test bank:', error)
    throw error
  }
}

// Run if executed directly
if (require.main === module) {
  seedTestBank()
    .then(() => {
      console.log('🎉 Seed completed!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Failed to seed:', error)
      process.exit(1)
    })
}

export { seedTestBank }
