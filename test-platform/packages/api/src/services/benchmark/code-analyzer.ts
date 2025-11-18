/**
 * Code Quality Analyzer
 * Performs static analysis on generated code to calculate quality scores
 */

import type { CodeQualityAnalysis } from './types'

export class CodeAnalyzer {
  /**
   * Analyze code quality and return detailed metrics
   */
  analyze(code: string): CodeQualityAnalysis {
    return {
      complexity: this.analyzeComplexity(code),
      maintainability: this.analyzeMaintainability(code),
      documentation: this.analyzeDocumentation(code),
      typeUsage: this.analyzeTypeUsage(code),
      errorHandling: this.analyzeErrorHandling(code),
      bestPractices: this.analyzeBestPractices(code),
    }
  }

  /**
   * Calculate cyclomatic complexity
   */
  private analyzeComplexity(code: string) {
    const lines = code.split('\n')
    const linesOfCode = lines.filter((line) => {
      const trimmed = line.trim()
      return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*')
    }).length

    // Count decision points for cyclomatic complexity
    const decisionPoints =
      (code.match(/\bif\b/g) || []).length +
      (code.match(/\belse\s+if\b/g) || []).length +
      (code.match(/\bfor\b/g) || []).length +
      (code.match(/\bwhile\b/g) || []).length +
      (code.match(/\bcase\b/g) || []).length +
      (code.match(/\bcatch\b/g) || []).length +
      (code.match(/\?\s*.*\s*:/g) || []).length + // ternary
      (code.match(/&&/g) || []).length +
      (code.match(/\|\|/g) || []).length

    const cyclomaticComplexity = decisionPoints + 1

    // Estimate nesting depth
    let maxNesting = 0
    let currentNesting = 0
    for (const line of lines) {
      const openBraces = (line.match(/{/g) || []).length
      const closeBraces = (line.match(/}/g) || []).length
      currentNesting += openBraces - closeBraces
      maxNesting = Math.max(maxNesting, currentNesting)
    }

    // Score: lower complexity is better
    let score = 100
    if (cyclomaticComplexity > 30) score -= 50
    else if (cyclomaticComplexity > 20) score -= 30
    else if (cyclomaticComplexity > 10) score -= 15

    if (maxNesting > 5) score -= 20
    else if (maxNesting > 4) score -= 10

    return {
      cyclomaticComplexity,
      cognitiveComplexity: Math.floor(cyclomaticComplexity * 1.3), // Estimate
      linesOfCode,
      maxNestingDepth: maxNesting,
      score: Math.max(0, score),
    }
  }

  /**
   * Analyze code maintainability
   */
  private analyzeMaintainability(code: string) {
    const lines = code.split('\n').filter((l) => l.trim())
    const linesOfCode = lines.length

    // Count functions
    const functionMatches = code.match(/function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>|\w+\s*\([^)]*\)\s*{/g) || []
    const functionCount = functionMatches.length

    // Average function length
    const avgFunctionLength = functionCount > 0 ? linesOfCode / functionCount : linesOfCode

    // Duplicate code detection (simple heuristic)
    const lineHashes = new Set()
    let duplicateLines = 0
    for (const line of lines) {
      const normalized = line.trim().replace(/\s+/g, ' ')
      if (normalized.length > 20) {
        if (lineHashes.has(normalized)) {
          duplicateLines++
        }
        lineHashes.add(normalized)
      }
    }
    const duplicateCode = lines.length > 0 ? (duplicateLines / lines.length) * 100 : 0

    // Calculate maintainability index (simplified version)
    const maintainabilityIndex = Math.max(
      0,
      Math.min(100, 100 - avgFunctionLength / 2 - duplicateCode)
    )

    let score = maintainabilityIndex
    if (avgFunctionLength > 50) score -= 20
    if (duplicateCode > 20) score -= 30

    return {
      maintainabilityIndex,
      functionCount,
      averageFunctionLength: Math.floor(avgFunctionLength),
      duplicateCode: Math.floor(duplicateCode),
      score: Math.max(0, Math.floor(score)),
    }
  }

  /**
   * Analyze documentation quality
   */
  private analyzeDocumentation(code: string) {
    const lines = code.split('\n')

    // Count JSDoc blocks
    const jsdocBlocks = (code.match(/\/\*\*[\s\S]*?\*\//g) || []).length

    // Count functions
    const functionMatches = code.match(/function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>|\w+\s*\([^)]*\)\s*{/g) || []
    const functionCount = functionMatches.length

    // JSDoc coverage
    const jsdocCoverage = functionCount > 0 ? (jsdocBlocks / functionCount) * 100 : 0

    // Comment density (comments per 100 lines)
    const commentLines = lines.filter((l) => l.trim().startsWith('//') || l.trim().startsWith('*')).length
    const codeLines = lines.filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*')).length
    const commentDensity = codeLines > 0 ? (commentLines / codeLines) * 100 : 0

    // Check for examples in JSDoc
    const hasExamples = code.includes('@example')

    // Check for type annotations in JSDoc
    const hasTypes = code.includes('@param') || code.includes('@returns')

    let score = 0
    score += jsdocCoverage > 80 ? 40 : jsdocCoverage > 50 ? 25 : jsdocCoverage > 20 ? 10 : 0
    score += hasExamples ? 20 : 0
    score += hasTypes ? 20 : 0
    score += commentDensity > 10 ? 20 : commentDensity > 5 ? 10 : 0

    return {
      jsdocCoverage: Math.floor(jsdocCoverage),
      commentDensity: Math.floor(commentDensity),
      hasExamples,
      hasTypes,
      score,
    }
  }

  /**
   * Analyze TypeScript type usage
   */
  private analyzeTypeUsage(code: string) {
    // Count type annotations
    const typeAnnotations = (code.match(/:\s*\w+(<[\s\S]*?>)?/g) || []).length

    // Count 'any' usage (bad practice)
    const anyTypeUsage = (code.match(/:\s*any\b/g) || []).length

    // Count generics usage
    const genericsUsage = (code.match(/<[A-Z]\w*(?:\s+extends\s+\w+)?>/g) || []).length

    // Count advanced types (union, intersection, conditional, mapped)
    const advancedTypesUsage =
      (code.match(/\|/g) || []).length + // union
      (code.match(/&/g) || []).length + // intersection
      (code.match(/\?\s*:/g) || []).length + // conditional
      (code.match(/\[K\s+in\s+/g) || []).length // mapped

    // Estimate total possible annotation points
    const possibleAnnotations =
      (code.match(/\bfunction\b/g) || []).length +
      (code.match(/\bconst\b/g) || []).length +
      (code.match(/\blet\b/g) || []).length

    const typeAnnotationCoverage =
      possibleAnnotations > 0 ? (typeAnnotations / possibleAnnotations) * 100 : 100

    let score = 0
    score += typeAnnotationCoverage > 80 ? 40 : typeAnnotationCoverage > 50 ? 25 : 10
    score -= anyTypeUsage * 5 // Penalty for 'any'
    score += genericsUsage > 0 ? 30 : 0
    score += advancedTypesUsage > 0 ? 20 : 0

    return {
      typeAnnotationCoverage: Math.floor(typeAnnotationCoverage),
      anyTypeUsage,
      genericsUsage,
      advancedTypesUsage,
      score: Math.max(0, Math.min(100, score)),
    }
  }

  /**
   * Analyze error handling
   */
  private analyzeErrorHandling(code: string) {
    const tryCatchBlocks = (code.match(/try\s*{[\s\S]*?}\s*catch/g) || []).length

    // Check for custom error types
    const errorTypes = (code.match(/class\s+\w+Error\s+extends\s+Error/g) || []).length

    // Check for error validation
    const errorValidation =
      code.includes('instanceof Error') || code.includes('error.message')

    let score = 0
    score += tryCatchBlocks > 0 ? 40 : 0
    score += errorTypes > 0 ? 30 : 0
    score += errorValidation ? 30 : 0

    return {
      tryCatchBlocks,
      errorTypes,
      errorValidation,
      score,
    }
  }

  /**
   * Analyze best practices adherence
   */
  private analyzeBestPractices(code: string) {
    // Naming conventions (camelCase for variables/functions, PascalCase for classes)
    const camelCaseVars = (code.match(/\b[a-z][a-zA-Z0-9]*\b/g) || []).length
    const pascalCaseClasses = (code.match(/\bclass\s+[A-Z][a-zA-Z0-9]*/g) || []).length
    const namingConventions = camelCaseVars > 0 || pascalCaseClasses > 0

    // Single Responsibility Principle (function length heuristic)
    const functions = code.match(/function\s+\w+[\s\S]*?^}/gm) || []
    const singleResponsibility = functions.every((fn) => fn.split('\n').length < 50)

    // DRY Principle (low duplication)
    const duplicateCode = this.analyzeMaintainability(code).duplicateCode
    const dryPrinciple = duplicateCode < 15

    // SOLID principles (simplified heuristics)
    let solidPrinciples = 0
    if (singleResponsibility) solidPrinciples++ // S
    if (code.includes('interface') || code.includes('type ')) solidPrinciples++ // I & D
    if (code.includes('extends') || code.includes('implements')) solidPrinciples++ // O & L
    if (dryPrinciple) solidPrinciples++ // (loosely related)

    let score = 0
    score += namingConventions ? 25 : 0
    score += singleResponsibility ? 25 : 0
    score += dryPrinciple ? 25 : 0
    score += solidPrinciples * 5

    return {
      namingConventions,
      singleResponsibility,
      dryPrinciple,
      solidPrinciples,
      score: Math.min(100, score),
    }
  }

  /**
   * Calculate overall code quality score (0-100)
   */
  calculateOverallScore(analysis: CodeQualityAnalysis): number {
    const weights = {
      complexity: 0.2,
      maintainability: 0.2,
      documentation: 0.15,
      typeUsage: 0.15,
      errorHandling: 0.15,
      bestPractices: 0.15,
    }

    return Math.floor(
      analysis.complexity.score * weights.complexity +
        analysis.maintainability.score * weights.maintainability +
        analysis.documentation.score * weights.documentation +
        analysis.typeUsage.score * weights.typeUsage +
        analysis.errorHandling.score * weights.errorHandling +
        analysis.bestPractices.score * weights.bestPractices
    )
  }
}
