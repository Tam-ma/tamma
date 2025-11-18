/**
 * Test Bank Seed Data
 * TypeScript - Code Generation - Easy Tasks
 */

import type { CreateTestBankTask } from '../../types/test-bank.types'
import { getCodeGenRoleEvaluations } from './role-evaluations'

export const typescriptCodeGenEasyTasks: CreateTestBankTask[] = [
  // Task 1: Email Validation
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Email Validation Function',
    description: 'Create a function that validates email addresses using regex',
    prompt: `Write a TypeScript function \`validateEmail(email: string): boolean\` that:
- Returns true if email is valid (basic RFC 5322 check)
- Returns false otherwise
- Handles edge cases: empty string, whitespace, missing @ symbol
- Include JSDoc comments
- Use strict TypeScript typing`,
    solution: `/**
 * Validates email addresses using regex
 * @param email - Email string to validate
 * @returns true if valid, false otherwise
 */
function validateEmail(email: string): boolean {
  if (!email || email.trim().length === 0) return false;
  const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return regex.test(email.trim());
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'valid email', input: 'test@example.com', expected: true },
        { description: 'invalid email without @', input: 'invalid-email', expected: false },
        { description: 'empty string', input: '', expected: false },
        { description: 'whitespace only', input: '  ', expected: false },
        { description: 'missing domain', input: 'test@', expected: false },
        { description: 'missing local part', input: '@example.com', expected: false },
        { description: 'space in email', input: 'test @example.com', expected: false },
        { description: 'missing TLD', input: 'test@example', expected: false },
        { description: 'email with plus', input: 'test+tag@example.com', expected: true },
        { description: 'subdomain email', input: 'test.name@example.co.uk', expected: true },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.0,
      maxLines: 15,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['validation', 'regex', 'string-manipulation'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 2: Capitalize String
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Capitalize First Letter',
    description: 'Create a function that capitalizes the first letter of a string',
    prompt: `Write a TypeScript function \`capitalize(str: string): string\` that:
- Capitalizes the first letter of the input string
- Lowercases all other letters
- Handles empty strings
- Handles strings with leading whitespace
- Include JSDoc comments`,
    solution: `/**
 * Capitalizes the first letter of a string
 * @param str - Input string
 * @returns String with first letter capitalized
 */
function capitalize(str: string): string {
  if (!str || str.length === 0) return str;
  const trimmed = str.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'lowercase word', input: 'hello', expected: 'Hello' },
        { description: 'uppercase word', input: 'WORLD', expected: 'World' },
        { description: 'mixed case', input: 'hElLo', expected: 'Hello' },
        { description: 'empty string', input: '', expected: '' },
        { description: 'whitespace only', input: '   ', expected: '' },
        { description: 'leading whitespace', input: '  hello', expected: 'Hello' },
        { description: 'single character', input: 'a', expected: 'A' },
        { description: 'already capitalized', input: 'Hello', expected: 'Hello' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.0,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'formatting'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 3: Array Sum
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Sum Array Numbers',
    description: 'Create a function that calculates the sum of numbers in an array',
    prompt: `Write a TypeScript function \`sum(numbers: number[]): number\` that:
- Returns the sum of all numbers in the array
- Returns 0 for empty arrays
- Uses modern TypeScript features
- Include JSDoc comments`,
    solution: `/**
 * Calculates the sum of all numbers in an array
 * @param numbers - Array of numbers to sum
 * @returns Sum of all numbers
 */
function sum(numbers: number[]): number {
  return numbers.reduce((acc, num) => acc + num, 0);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'positive numbers', input: [1, 2, 3, 4, 5], expected: 15 },
        { description: 'negative numbers', input: [-1, -2, -3], expected: -6 },
        { description: 'mixed numbers', input: [1, -2, 3, -4], expected: -2 },
        { description: 'single number', input: [42], expected: 42 },
        { description: 'empty array', input: [], expected: 0 },
        { description: 'zeros', input: [0, 0, 0], expected: 0 },
        { description: 'decimals', input: [1.5, 2.5, 3], expected: 7 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'reduce', 'math'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 4: Is Even Number
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Check Even Number',
    description: 'Create a function that checks if a number is even',
    prompt: `Write a TypeScript function \`isEven(n: number): boolean\` that:
- Returns true if the number is even
- Returns false if the number is odd
- Handles negative numbers correctly
- Include JSDoc comments`,
    solution: `/**
 * Checks if a number is even
 * @param n - Number to check
 * @returns true if even, false if odd
 */
function isEven(n: number): boolean {
  return n % 2 === 0;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'even positive', input: 4, expected: true },
        { description: 'odd positive', input: 5, expected: false },
        { description: 'zero', input: 0, expected: true },
        { description: 'even negative', input: -4, expected: true },
        { description: 'odd negative', input: -5, expected: false },
        { description: 'large even', input: 1000, expected: true },
        { description: 'large odd', input: 1001, expected: false },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'modulo', 'boolean'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 5: Reverse String
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Reverse String',
    description: 'Create a function that reverses a string',
    prompt: `Write a TypeScript function \`reverse(str: string): string\` that:
- Returns the input string reversed
- Handles empty strings
- Uses modern JavaScript/TypeScript methods
- Include JSDoc comments`,
    solution: `/**
 * Reverses a string
 * @param str - String to reverse
 * @returns Reversed string
 */
function reverse(str: string): string {
  return str.split('').reverse().join('');
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'simple word', input: 'hello', expected: 'olleh' },
        { description: 'palindrome', input: 'racecar', expected: 'racecar' },
        { description: 'empty string', input: '', expected: '' },
        { description: 'single character', input: 'a', expected: 'a' },
        { description: 'with spaces', input: 'hello world', expected: 'dlrow olleh' },
        { description: 'with numbers', input: 'abc123', expected: '321cba' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'array-methods'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 6: Find Maximum
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Find Maximum Number',
    description: 'Create a function that finds the maximum number in an array',
    prompt: `Write a TypeScript function \`findMax(numbers: number[]): number | null\` that:
- Returns the largest number in the array
- Returns null for empty arrays
- Handles negative numbers
- Include JSDoc comments`,
    solution: `/**
 * Finds the maximum number in an array
 * @param numbers - Array of numbers
 * @returns Maximum number or null if array is empty
 */
function findMax(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'positive numbers', input: [1, 5, 3, 9, 2], expected: 9 },
        { description: 'negative numbers', input: [-5, -1, -10, -3], expected: -1 },
        { description: 'mixed numbers', input: [-5, 10, -2, 8], expected: 10 },
        { description: 'single number', input: [42], expected: 42 },
        { description: 'empty array', input: [], expected: null },
        { description: 'all same', input: [7, 7, 7], expected: 7 },
        { description: 'decimals', input: [1.5, 2.8, 1.2], expected: 2.8 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'math', 'spread-operator'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 7: Count Vowels
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Count Vowels',
    description: 'Create a function that counts vowels in a string',
    prompt: `Write a TypeScript function \`countVowels(str: string): number\` that:
- Returns the count of vowels (a, e, i, o, u) in the string
- Is case-insensitive
- Handles empty strings
- Include JSDoc comments`,
    solution: `/**
 * Counts the number of vowels in a string
 * @param str - Input string
 * @returns Number of vowels
 */
function countVowels(str: string): number {
  const vowels = 'aeiouAEIOU';
  return str.split('').filter(char => vowels.includes(char)).length;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'lowercase', input: 'hello', expected: 2 },
        { description: 'uppercase', input: 'WORLD', expected: 1 },
        { description: 'mixed case', input: 'JavaScript', expected: 3 },
        { description: 'no vowels', input: 'xyz', expected: 0 },
        { description: 'all vowels', input: 'aeiou', expected: 5 },
        { description: 'empty string', input: '', expected: 0 },
        { description: 'with spaces', input: 'hello world', expected: 3 },
        { description: 'with numbers', input: 'abc123', expected: 1 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'filter', 'counting'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 8: Is Palindrome
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Check Palindrome',
    description: 'Create a function that checks if a string is a palindrome',
    prompt: `Write a TypeScript function \`isPalindrome(str: string): boolean\` that:
- Returns true if the string is a palindrome (reads same forwards and backwards)
- Is case-insensitive
- Ignores spaces and punctuation
- Include JSDoc comments`,
    solution: `/**
 * Checks if a string is a palindrome
 * @param str - Input string
 * @returns true if palindrome, false otherwise
 */
function isPalindrome(str: string): boolean {
  const cleaned = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned === cleaned.split('').reverse().join('');
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'simple palindrome', input: 'racecar', expected: true },
        { description: 'not palindrome', input: 'hello', expected: false },
        { description: 'with capitals', input: 'RaceCar', expected: true },
        { description: 'with spaces', input: 'race car', expected: true },
        { description: 'with punctuation', input: 'A man, a plan, a canal: Panama', expected: true },
        { description: 'single character', input: 'a', expected: true },
        { description: 'empty string', input: '', expected: true },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'palindrome', 'regex'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 9: Filter Even Numbers
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Filter Even Numbers',
    description: 'Create a function that filters even numbers from an array',
    prompt: `Write a TypeScript function \`filterEven(numbers: number[]): number[]\` that:
- Returns a new array containing only even numbers
- Preserves the original order
- Returns empty array if no even numbers found
- Include JSDoc comments`,
    solution: `/**
 * Filters even numbers from an array
 * @param numbers - Array of numbers
 * @returns Array containing only even numbers
 */
function filterEven(numbers: number[]): number[] {
  return numbers.filter(n => n % 2 === 0);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'mixed numbers', input: [1, 2, 3, 4, 5, 6], expected: [2, 4, 6] },
        { description: 'all even', input: [2, 4, 6], expected: [2, 4, 6] },
        { description: 'all odd', input: [1, 3, 5], expected: [] },
        { description: 'negative numbers', input: [-2, -1, 0, 1, 2], expected: [-2, 0, 2] },
        { description: 'empty array', input: [], expected: [] },
        { description: 'single even', input: [4], expected: [4] },
        { description: 'single odd', input: [3], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'filter', 'even-numbers'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 10: Repeat String
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Repeat String',
    description: 'Create a function that repeats a string n times',
    prompt: `Write a TypeScript function \`repeat(str: string, times: number): string\` that:
- Returns the string repeated the specified number of times
- Returns empty string if times is 0 or negative
- Handles empty input strings
- Include JSDoc comments`,
    solution: `/**
 * Repeats a string n times
 * @param str - String to repeat
 * @param times - Number of times to repeat
 * @returns Repeated string
 */
function repeat(str: string, times: number): string {
  if (times <= 0) return '';
  return str.repeat(times);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'normal repeat', input: ['abc', 3], expected: 'abcabcabc' },
        { description: 'repeat once', input: ['hello', 1], expected: 'hello' },
        { description: 'repeat zero', input: ['test', 0], expected: '' },
        { description: 'negative times', input: ['test', -5], expected: '' },
        { description: 'empty string', input: ['', 5], expected: '' },
        { description: 'single char', input: ['x', 5], expected: 'xxxxx' },
        { description: 'large repeat', input: ['ab', 10], expected: 'abababababababababab' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'repeat'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 11: Remove Duplicates
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Remove Duplicate Array Elements',
    description: 'Create a function that removes duplicate values from an array',
    prompt: `Write a TypeScript function \`removeDuplicates<T>(arr: T[]): T[]\` that:
- Returns a new array with duplicates removed
- Preserves the order of first occurrence
- Works with any primitive type (generic)
- Include JSDoc comments`,
    solution: `/**
 * Removes duplicate values from an array
 * @param arr - Array with potential duplicates
 * @returns Array with duplicates removed
 */
function removeDuplicates<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'numbers with duplicates', input: [1, 2, 2, 3, 4, 4, 5], expected: [1, 2, 3, 4, 5] },
        { description: 'strings with duplicates', input: ['a', 'b', 'a', 'c'], expected: ['a', 'b', 'c'] },
        { description: 'no duplicates', input: [1, 2, 3], expected: [1, 2, 3] },
        { description: 'all duplicates', input: [1, 1, 1], expected: [1] },
        { description: 'empty array', input: [], expected: [] },
        { description: 'single element', input: [42], expected: [42] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'set', 'deduplication', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 12: Truncate String
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Truncate String with Ellipsis',
    description: 'Create a function that truncates a string to a maximum length',
    prompt: `Write a TypeScript function \`truncate(str: string, maxLength: number): string\` that:
- Returns the string if it's shorter than maxLength
- Truncates and adds "..." if longer than maxLength (ellipsis counts toward maxLength)
- Handles edge cases: empty string, maxLength < 3
- Include JSDoc comments`,
    solution: `/**
 * Truncates a string to maximum length with ellipsis
 * @param str - String to truncate
 * @param maxLength - Maximum length including ellipsis
 * @returns Truncated string
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  if (maxLength < 3) return str.slice(0, maxLength);
  return str.slice(0, maxLength - 3) + '...';
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'shorter than max', input: ['hello', 10], expected: 'hello' },
        { description: 'needs truncation', input: ['hello world', 8], expected: 'hello...'},
        { description: 'exact length', input: ['hello', 5], expected: 'hello' },
        { description: 'very short max', input: ['hello', 2], expected: 'he' },
        { description: 'empty string', input: ['', 5], expected: '' },
        { description: 'max is 3', input: ['hello', 3], expected: 'hel' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'truncate'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 13: Chunk Array
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Chunk Array into Groups',
    description: 'Create a function that splits an array into chunks of specified size',
    prompt: `Write a TypeScript function \`chunk<T>(arr: T[], size: number): T[][]\` that:
- Returns array split into chunks of given size
- Last chunk may be smaller if elements don't divide evenly
- Returns empty array for empty input
- Handles size <= 0 by returning empty array
- Include JSDoc comments`,
    solution: `/**
 * Splits an array into chunks of specified size
 * @param arr - Array to chunk
 * @param size - Size of each chunk
 * @returns Array of chunks
 */
function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'even division', input: [[1, 2, 3, 4, 5, 6], 2], expected: [[1, 2], [3, 4], [5, 6]] },
        { description: 'uneven division', input: [[1, 2, 3, 4, 5], 2], expected: [[1, 2], [3, 4], [5]] },
        { description: 'chunk size 1', input: [[1, 2, 3], 1], expected: [[1], [2], [3]] },
        { description: 'chunk larger than array', input: [[1, 2], 5], expected: [[1, 2]] },
        { description: 'empty array', input: [[], 2], expected: [] },
        { description: 'size 0', input: [[1, 2, 3], 0], expected: [] },
        { description: 'negative size', input: [[1, 2, 3], -1], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 15,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'chunking', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 14: Flatten Array
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Flatten Nested Array (One Level)',
    description: 'Create a function that flattens a nested array by one level',
    prompt: `Write a TypeScript function \`flatten<T>(arr: (T | T[])[]): T[]\` that:
- Flattens nested array by exactly one level
- Returns new array with all sub-array elements concatenated
- Handles empty arrays
- Include JSDoc comments`,
    solution: `/**
 * Flattens a nested array by one level
 * @param arr - Array to flatten
 * @returns Flattened array
 */
function flatten<T>(arr: (T | T[])[]): T[] {
  return arr.flat() as T[];
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'simple nested', input: [[1, 2], [3, 4], [5]], expected: [1, 2, 3, 4, 5] },
        { description: 'mixed elements', input: [1, [2, 3], 4, [5]], expected: [1, 2, 3, 4, 5] },
        { description: 'empty sub-arrays', input: [[1], [], [2, 3]], expected: [1, 2, 3] },
        { description: 'all empty', input: [[], [], []], expected: [] },
        { description: 'no nesting', input: [1, 2, 3], expected: [1, 2, 3] },
        { description: 'single nested', input: [[1, 2, 3]], expected: [1, 2, 3] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'flatten', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 15: Get Unique Values
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Get Unique Values from Multiple Arrays',
    description: 'Create a function that returns unique values from multiple arrays',
    prompt: `Write a TypeScript function \`getUnique<T>(...arrays: T[][]): T[]\` that:
- Accepts multiple arrays as arguments
- Returns array of unique values across all input arrays
- Preserves order of first occurrence
- Include JSDoc comments`,
    solution: `/**
 * Gets unique values from multiple arrays
 * @param arrays - Multiple arrays to process
 * @returns Array of unique values
 */
function getUnique<T>(...arrays: T[][]): T[] {
  const combined = arrays.flat();
  return [...new Set(combined)];
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'two arrays', input: [[1, 2], [2, 3]], expected: [1, 2, 3] },
        { description: 'three arrays', input: [[1, 2], [2, 3], [3, 4]], expected: [1, 2, 3, 4] },
        { description: 'no overlap', input: [[1, 2], [3, 4]], expected: [1, 2, 3, 4] },
        { description: 'all same', input: [[1, 1], [1, 1]], expected: [1] },
        { description: 'empty arrays', input: [[], []], expected: [] },
        { description: 'single array', input: [[1, 2, 2, 3]], expected: [1, 2, 3] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'set', 'variadic', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 16: String to Title Case
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Convert to Title Case',
    description: 'Create a function that converts a string to title case',
    prompt: `Write a TypeScript function \`toTitleCase(str: string): string\` that:
- Capitalizes first letter of each word
- Lowercases all other letters
- Treats spaces as word separators
- Handles empty strings and single words
- Include JSDoc comments`,
    solution: `/**
 * Converts a string to title case
 * @param str - Input string
 * @returns Title-cased string
 */
function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'lowercase words', input: 'hello world', expected: 'Hello World' },
        { description: 'uppercase words', input: 'HELLO WORLD', expected: 'Hello World' },
        { description: 'mixed case', input: 'hElLo WoRlD', expected: 'Hello World' },
        { description: 'single word', input: 'hello', expected: 'Hello' },
        { description: 'empty string', input: '', expected: '' },
        { description: 'multiple spaces', input: 'hello  world', expected: 'Hello  World' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'formatting', 'map'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 17: Calculate Average
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Calculate Average of Numbers',
    description: 'Create a function that calculates the average of an array of numbers',
    prompt: `Write a TypeScript function \`average(numbers: number[]): number\` that:
- Returns the arithmetic mean of the numbers
- Returns 0 for empty arrays
- Handles negative numbers and decimals
- Include JSDoc comments`,
    solution: `/**
 * Calculates the average of an array of numbers
 * @param numbers - Array of numbers
 * @returns Average value
 */
function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, num) => acc + num, 0);
  return sum / numbers.length;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'positive integers', input: [1, 2, 3, 4, 5], expected: 3 },
        { description: 'with decimals', input: [1.5, 2.5, 3.5], expected: 2.5 },
        { description: 'negative numbers', input: [-2, -4, -6], expected: -4 },
        { description: 'mixed numbers', input: [-1, 0, 1], expected: 0 },
        { description: 'single number', input: [42], expected: 42 },
        { description: 'empty array', input: [], expected: 0 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'array', 'reduce', 'statistics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 18: Deep Clone Object
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Deep Clone Simple Object',
    description: 'Create a function that deep clones a simple object',
    prompt: `Write a TypeScript function \`deepClone<T>(obj: T): T\` that:
- Creates a deep copy of an object
- Works with nested objects and arrays
- Uses JSON methods (simple approach for plain objects)
- Include JSDoc comments
- Note: Assume input contains only JSON-serializable data`,
    solution: `/**
 * Creates a deep clone of an object
 * @param obj - Object to clone
 * @returns Deep cloned object
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'simple object', input: { a: 1, b: 2 }, expected: { a: 1, b: 2 } },
        { description: 'nested object', input: { a: { b: { c: 1 } } }, expected: { a: { b: { c: 1 } } } },
        { description: 'with array', input: { arr: [1, 2, 3] }, expected: { arr: [1, 2, 3] } },
        { description: 'array', input: [1, 2, 3], expected: [1, 2, 3] },
        { description: 'null', input: null, expected: null },
        { description: 'empty object', input: {}, expected: {} },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['object', 'clone', 'json', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 19: Swap Key-Value Pairs
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Swap Object Keys and Values',
    description: 'Create a function that swaps keys and values in an object',
    prompt: `Write a TypeScript function \`swapKeyValue(obj: Record<string, string>): Record<string, string>\` that:
- Returns new object with keys and values swapped
- Handles empty objects
- Assumes all values are strings
- Include JSDoc comments`,
    solution: `/**
 * Swaps keys and values in an object
 * @param obj - Object with string values
 * @returns New object with swapped keys and values
 */
function swapKeyValue(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [value, key])
  );
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'simple object', input: { a: 'x', b: 'y' }, expected: { x: 'a', y: 'b' } },
        { description: 'numeric values', input: { one: '1', two: '2' }, expected: { '1': 'one', '2': 'two' } },
        { description: 'empty object', input: {}, expected: {} },
        { description: 'single pair', input: { key: 'value' }, expected: { value: 'key' } },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['object', 'transform', 'entries'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 20: Find Index of Element
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Find First Index of Element',
    description: 'Create a function that finds the first index of an element',
    prompt: `Write a TypeScript function \`findIndex<T>(arr: T[], element: T): number\` that:
- Returns the first index where element is found
- Returns -1 if element is not found
- Uses strict equality (===)
- Include JSDoc comments`,
    solution: `/**
 * Finds the first index of an element in an array
 * @param arr - Array to search
 * @param element - Element to find
 * @returns Index of element or -1 if not found
 */
function findIndex<T>(arr: T[], element: T): number {
  return arr.indexOf(element);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'element exists', input: [[1, 2, 3, 4], 3], expected: 2 },
        { description: 'element not found', input: [[1, 2, 3], 5], expected: -1 },
        { description: 'first occurrence', input: [[1, 2, 2, 3], 2], expected: 1 },
        { description: 'at start', input: [[5, 2, 3], 5], expected: 0 },
        { description: 'at end', input: [[1, 2, 5], 5], expected: 2 },
        { description: 'empty array', input: [[], 1], expected: -1 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'search', 'indexOf', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 21: Merge Two Arrays Alternately
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Merge Arrays Alternately',
    description: 'Create a function that merges two arrays by alternating elements',
    prompt: `Write a TypeScript function \`mergeAlternate<T>(arr1: T[], arr2: T[]): T[]\` that:
- Merges two arrays by alternating elements from each
- If one array is longer, append remaining elements at the end
- Handles empty arrays
- Include JSDoc comments`,
    solution: `/**
 * Merges two arrays by alternating elements
 * @param arr1 - First array
 * @param arr2 - Second array
 * @returns Merged array with alternating elements
 */
function mergeAlternate<T>(arr1: T[], arr2: T[]): T[] {
  const result: T[] = [];
  const maxLength = Math.max(arr1.length, arr2.length);

  for (let i = 0; i < maxLength; i++) {
    if (i < arr1.length) result.push(arr1[i]);
    if (i < arr2.length) result.push(arr2[i]);
  }

  return result;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'equal length', input: [[1, 2, 3], [4, 5, 6]], expected: [1, 4, 2, 5, 3, 6] },
        { description: 'first longer', input: [[1, 2, 3], [4, 5]], expected: [1, 4, 2, 5, 3] },
        { description: 'second longer', input: [[1, 2], [3, 4, 5]], expected: [1, 3, 2, 4, 5] },
        { description: 'first empty', input: [[], [1, 2]], expected: [1, 2] },
        { description: 'second empty', input: [[1, 2], []], expected: [1, 2] },
        { description: 'both empty', input: [[], []], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 15,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'merge', 'interleave', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 22: Count Character Occurrences
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Count Character Occurrences',
    description: 'Create a function that counts occurrences of a character in a string',
    prompt: `Write a TypeScript function \`countChar(str: string, char: string): number\` that:
- Returns count of how many times char appears in str
- Is case-sensitive
- Handles empty strings
- Returns 0 if char is not a single character
- Include JSDoc comments`,
    solution: `/**
 * Counts occurrences of a character in a string
 * @param str - String to search in
 * @param char - Character to count
 * @returns Number of occurrences
 */
function countChar(str: string, char: string): number {
  if (char.length !== 1) return 0;
  return str.split(char).length - 1;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'multiple occurrences', input: ['hello', 'l'], expected: 2 },
        { description: 'single occurrence', input: ['hello', 'h'], expected: 1 },
        { description: 'no occurrence', input: ['hello', 'x'], expected: 0 },
        { description: 'empty string', input: ['', 'a'], expected: 0 },
        { description: 'case sensitive', input: ['Hello', 'h'], expected: 0 },
        { description: 'multi-char input', input: ['hello', 'll'], expected: 0 },
        { description: 'all same char', input: ['aaaa', 'a'], expected: 4 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'counting', 'split'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 23: Get Initials
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Get Initials from Name',
    description: 'Create a function that extracts initials from a full name',
    prompt: `Write a TypeScript function \`getInitials(name: string): string\` that:
- Returns uppercase initials from a full name
- Takes first letter of each word
- Handles multiple spaces between words
- Returns empty string for empty input
- Include JSDoc comments`,
    solution: `/**
 * Extracts initials from a full name
 * @param name - Full name
 * @returns Uppercase initials
 */
function getInitials(name: string): string {
  return name
    .trim()
    .split(/\\s+/)
    .map(word => word.charAt(0).toUpperCase())
    .join('');
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'two words', input: 'John Doe', expected: 'JD' },
        { description: 'three words', input: 'John Paul Jones', expected: 'JPJ' },
        { description: 'lowercase', input: 'jane smith', expected: 'JS' },
        { description: 'multiple spaces', input: 'John  Doe', expected: 'JD' },
        { description: 'single word', input: 'John', expected: 'J' },
        { description: 'empty string', input: '', expected: '' },
        { description: 'whitespace only', input: '   ', expected: '' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'regex', 'initials'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 24: Range Function
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Generate Number Range',
    description: 'Create a function that generates an array of numbers in a range',
    prompt: `Write a TypeScript function \`range(start: number, end: number): number[]\` that:
- Returns array of numbers from start to end (inclusive)
- Handles ascending ranges (start < end)
- Returns empty array if start > end
- Include JSDoc comments`,
    solution: `/**
 * Generates an array of numbers in a range
 * @param start - Starting number (inclusive)
 * @param end - Ending number (inclusive)
 * @returns Array of numbers in range
 */
function range(start: number, end: number): number[] {
  if (start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'positive range', input: [1, 5], expected: [1, 2, 3, 4, 5] },
        { description: 'from zero', input: [0, 3], expected: [0, 1, 2, 3] },
        { description: 'negative range', input: [-3, 0], expected: [-3, -2, -1, 0] },
        { description: 'same number', input: [5, 5], expected: [5] },
        { description: 'reversed', input: [5, 1], expected: [] },
        { description: 'large range', input: [1, 10], expected: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'range', 'array-from'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 25: Remove Falsy Values
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Remove Falsy Values from Array',
    description: 'Create a function that removes all falsy values from an array',
    prompt: `Write a TypeScript function \`compact<T>(arr: T[]): T[]\` that:
- Removes all falsy values (false, null, 0, "", undefined, NaN)
- Returns new array with only truthy values
- Preserves order
- Include JSDoc comments`,
    solution: `/**
 * Removes all falsy values from an array
 * @param arr - Array to compact
 * @returns Array with only truthy values
 */
function compact<T>(arr: T[]): T[] {
  return arr.filter(Boolean) as T[];
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'mixed values', input: [0, 1, false, 2, '', 3], expected: [1, 2, 3] },
        { description: 'with null and undefined', input: [1, null, 2, undefined, 3], expected: [1, 2, 3] },
        { description: 'all falsy', input: [0, false, '', null], expected: [] },
        { description: 'all truthy', input: [1, 'a', true], expected: [1, 'a', true] },
        { description: 'empty array', input: [], expected: [] },
        { description: 'with NaN', input: [1, NaN, 2], expected: [1, 2] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'filter', 'boolean', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 26: Object Keys Count
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Count Object Keys',
    description: 'Create a function that counts the number of keys in an object',
    prompt: `Write a TypeScript function \`countKeys(obj: Record<string, any>): number\` that:
- Returns the number of own enumerable properties
- Handles empty objects
- Only counts direct properties (not inherited)
- Include JSDoc comments`,
    solution: `/**
 * Counts the number of keys in an object
 * @param obj - Object to count keys from
 * @returns Number of keys
 */
function countKeys(obj: Record<string, any>): number {
  return Object.keys(obj).length;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'simple object', input: { a: 1, b: 2, c: 3 }, expected: 3 },
        { description: 'nested values', input: { a: { b: 1 }, c: 2 }, expected: 2 },
        { description: 'empty object', input: {}, expected: 0 },
        { description: 'single key', input: { key: 'value' }, expected: 1 },
        { description: 'with null values', input: { a: null, b: undefined, c: 0 }, expected: 3 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['object', 'keys', 'counting'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 27: Starts With Substring
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Check String Starts With',
    description: 'Create a function that checks if string starts with a substring',
    prompt: `Write a TypeScript function \`startsWith(str: string, prefix: string): boolean\` that:
- Returns true if str starts with prefix
- Is case-sensitive
- Handles empty strings (empty prefix should return true)
- Include JSDoc comments`,
    solution: `/**
 * Checks if a string starts with a given prefix
 * @param str - String to check
 * @param prefix - Prefix to look for
 * @returns true if str starts with prefix
 */
function startsWith(str: string, prefix: string): boolean {
  return str.startsWith(prefix);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'starts with prefix', input: ['hello world', 'hello'], expected: true },
        { description: 'does not start', input: ['hello world', 'world'], expected: false },
        { description: 'exact match', input: ['hello', 'hello'], expected: true },
        { description: 'empty prefix', input: ['hello', ''], expected: true },
        { description: 'empty string', input: ['', 'hello'], expected: false },
        { description: 'case sensitive', input: ['Hello', 'hello'], expected: false },
        { description: 'prefix longer', input: ['hi', 'hello'], expected: false },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'startsWith', 'boolean'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 28: Array Difference
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Find Array Difference',
    description: 'Create a function that finds elements in first array but not in second',
    prompt: `Write a TypeScript function \`difference<T>(arr1: T[], arr2: T[]): T[]\` that:
- Returns elements that are in arr1 but not in arr2
- Preserves order from arr1
- Removes duplicates from result
- Include JSDoc comments`,
    solution: `/**
 * Finds elements in first array but not in second
 * @param arr1 - First array
 * @param arr2 - Second array
 * @returns Elements in arr1 not in arr2
 */
function difference<T>(arr1: T[], arr2: T[]): T[] {
  const set2 = new Set(arr2);
  return [...new Set(arr1.filter(item => !set2.has(item)))];
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'simple difference', input: [[1, 2, 3, 4], [2, 4]], expected: [1, 3] },
        { description: 'no overlap', input: [[1, 2], [3, 4]], expected: [1, 2] },
        { description: 'complete overlap', input: [[1, 2], [1, 2]], expected: [] },
        { description: 'empty second', input: [[1, 2, 3], []], expected: [1, 2, 3] },
        { description: 'empty first', input: [[], [1, 2]], expected: [] },
        { description: 'with duplicates', input: [[1, 2, 2, 3], [2]], expected: [1, 3] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'set', 'difference', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 29: Pick Object Properties
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Pick Properties from Object',
    description: 'Create a function that picks specific properties from an object',
    prompt: `Write a TypeScript function \`pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>\` that:
- Returns new object with only specified keys
- Handles non-existent keys gracefully (skip them)
- Returns empty object if keys array is empty
- Include JSDoc comments`,
    solution: `/**
 * Picks specific properties from an object
 * @param obj - Source object
 * @param keys - Array of keys to pick
 * @returns New object with only specified keys
 */
function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  keys.forEach(key => {
    if (key in obj) {
      result[key] = obj[key];
    }
  });
  return result;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'pick some keys', input: [{ a: 1, b: 2, c: 3 }, ['a', 'c']], expected: { a: 1, c: 3 } },
        { description: 'pick single key', input: [{ a: 1, b: 2 }, ['a']], expected: { a: 1 } },
        { description: 'pick all keys', input: [{ a: 1, b: 2 }, ['a', 'b']], expected: { a: 1, b: 2 } },
        { description: 'empty keys', input: [{ a: 1, b: 2 }, []], expected: {} },
        { description: 'nested values', input: [{ a: { x: 1 }, b: 2 }, ['a']], expected: { a: { x: 1 } } },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 15,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['object', 'pick', 'utility-types', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 30: Sleep/Delay Function
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Create Async Sleep Function',
    description: 'Create a function that delays execution for specified milliseconds',
    prompt: `Write a TypeScript function \`sleep(ms: number): Promise<void>\` that:
- Returns a Promise that resolves after ms milliseconds
- Uses setTimeout internally
- Handles negative/zero values (resolve immediately)
- Include JSDoc comments`,
    solution: `/**
 * Delays execution for specified milliseconds
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after delay
 */
function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'positive delay', input: 100, expected: undefined },
        { description: 'zero delay', input: 0, expected: undefined },
        { description: 'negative delay', input: -100, expected: undefined },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['async', 'promise', 'delay', 'setTimeout'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 31: Clamp Number
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Clamp Number to Range',
    description: 'Create a function that clamps a number to a min-max range',
    prompt: `Write a TypeScript function \`clamp(num: number, min: number, max: number): number\` that:
- Returns num if it's within [min, max]
- Returns min if num < min
- Returns max if num > max
- Handles case where min > max (swap them)
- Include JSDoc comments`,
    solution: `/**
 * Clamps a number to a specified range
 * @param num - Number to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped number
 */
function clamp(num: number, min: number, max: number): number {
  const [lower, upper] = min <= max ? [min, max] : [max, min];
  return Math.min(Math.max(num, lower), upper);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'within range', input: [5, 0, 10], expected: 5 },
        { description: 'below min', input: [-5, 0, 10], expected: 0 },
        { description: 'above max', input: [15, 0, 10], expected: 10 },
        { description: 'at min', input: [0, 0, 10], expected: 0 },
        { description: 'at max', input: [10, 0, 10], expected: 10 },
        { description: 'swapped bounds', input: [5, 10, 0], expected: 5 },
        { description: 'negative range', input: [-15, -10, -5], expected: -10 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'clamp', 'range'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 32: Is Empty
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Check if Value is Empty',
    description: 'Create a function that checks if a value is empty',
    prompt: `Write a TypeScript function \`isEmpty(value: any): boolean\` that:
- Returns true for: null, undefined, empty string, empty array, empty object
- Returns false for: numbers (including 0), booleans, non-empty strings/arrays/objects
- Include JSDoc comments`,
    solution: `/**
 * Checks if a value is empty
 * @param value - Value to check
 * @returns true if empty, false otherwise
 */
function isEmpty(value: any): boolean {
  if (value == null) return true;
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'null', input: null, expected: true },
        { description: 'undefined', input: undefined, expected: true },
        { description: 'empty string', input: '', expected: true },
        { description: 'empty array', input: [], expected: true },
        { description: 'empty object', input: {}, expected: true },
        { description: 'number zero', input: 0, expected: false },
        { description: 'false', input: false, expected: false },
        { description: 'non-empty string', input: 'hello', expected: false },
        { description: 'non-empty array', input: [1], expected: false },
        { description: 'non-empty object', input: { a: 1 }, expected: false },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 15,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['validation', 'empty', 'type-checking'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 33: Sum Object Values
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Sum Numeric Object Values',
    description: 'Create a function that sums all numeric values in an object',
    prompt: `Write a TypeScript function \`sumValues(obj: Record<string, number>): number\` that:
- Returns the sum of all numeric values in the object
- Returns 0 for empty object
- Assumes all values are numbers
- Include JSDoc comments`,
    solution: `/**
 * Sums all numeric values in an object
 * @param obj - Object with numeric values
 * @returns Sum of all values
 */
function sumValues(obj: Record<string, number>): number {
  return Object.values(obj).reduce((sum, val) => sum + val, 0);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'positive numbers', input: { a: 1, b: 2, c: 3 }, expected: 6 },
        { description: 'negative numbers', input: { a: -1, b: -2, c: -3 }, expected: -6 },
        { description: 'mixed numbers', input: { a: 10, b: -5, c: 3 }, expected: 8 },
        { description: 'single value', input: { a: 42 }, expected: 42 },
        { description: 'empty object', input: {}, expected: 0 },
        { description: 'with zeros', input: { a: 0, b: 5, c: 0 }, expected: 5 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['object', 'values', 'reduce', 'math'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 34: Degrees to Radians
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Convert Degrees to Radians',
    description: 'Create a function that converts degrees to radians',
    prompt: `Write a TypeScript function \`degreesToRadians(degrees: number): number\` that:
- Converts angle from degrees to radians
- Uses formula: radians = degrees × (π / 180)
- Handles negative angles
- Include JSDoc comments`,
    solution: `/**
 * Converts degrees to radians
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: '0 degrees', input: 0, expected: 0 },
        { description: '180 degrees', input: 180, expected: Math.PI },
        { description: '90 degrees', input: 90, expected: Math.PI / 2 },
        { description: '360 degrees', input: 360, expected: 2 * Math.PI },
        { description: 'negative angle', input: -90, expected: -Math.PI / 2 },
        { description: '45 degrees', input: 45, expected: Math.PI / 4 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'conversion', 'trigonometry'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 35: Omit Object Properties
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Omit Properties from Object',
    description: 'Create a function that omits specific properties from an object',
    prompt: `Write a TypeScript function \`omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K>\` that:
- Returns new object without specified keys
- Handles non-existent keys gracefully
- Returns copy of object if keys array is empty
- Include JSDoc comments`,
    solution: `/**
 * Omits specific properties from an object
 * @param obj - Source object
 * @param keys - Array of keys to omit
 * @returns New object without specified keys
 */
function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  keys.forEach(key => delete result[key]);
  return result as Omit<T, K>;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'omit some keys', input: [{ a: 1, b: 2, c: 3 }, ['b']], expected: { a: 1, c: 3 } },
        { description: 'omit multiple', input: [{ a: 1, b: 2, c: 3 }, ['a', 'c']], expected: { b: 2 } },
        { description: 'omit all', input: [{ a: 1, b: 2 }, ['a', 'b']], expected: {} },
        { description: 'empty keys', input: [{ a: 1, b: 2 }, []], expected: { a: 1, b: 2 } },
        { description: 'nested values', input: [{ a: { x: 1 }, b: 2 }, ['b']], expected: { a: { x: 1 } } },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['object', 'omit', 'utility-types', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 36: Random Integer in Range
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Generate Random Integer',
    description: 'Create a function that generates a random integer in a range',
    prompt: `Write a TypeScript function \`randomInt(min: number, max: number): number\` that:
- Returns random integer between min and max (inclusive)
- Handles case where min > max (swap them)
- Uses Math.random() and Math.floor()
- Include JSDoc comments`,
    solution: `/**
 * Generates a random integer in a range
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns Random integer in range
 */
function randomInt(min: number, max: number): number {
  const [lower, upper] = min <= max ? [min, max] : [max, min];
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'in range 1-10', input: [1, 10], expected: 'in-range' },
        { description: 'same min max', input: [5, 5], expected: 5 },
        { description: 'swapped bounds', input: [10, 1], expected: 'in-range' },
        { description: 'negative range', input: [-5, -1], expected: 'in-range' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'random', 'range'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 37: First N Elements
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Get First N Elements',
    description: 'Create a function that returns first n elements of an array',
    prompt: `Write a TypeScript function \`take<T>(arr: T[], n: number): T[]\` that:
- Returns first n elements of array
- Returns entire array if n >= array length
- Returns empty array if n <= 0
- Include JSDoc comments`,
    solution: `/**
 * Returns first n elements of an array
 * @param arr - Source array
 * @param n - Number of elements to take
 * @returns Array of first n elements
 */
function take<T>(arr: T[], n: number): T[] {
  if (n <= 0) return [];
  return arr.slice(0, n);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'take some', input: [[1, 2, 3, 4, 5], 3], expected: [1, 2, 3] },
        { description: 'take all', input: [[1, 2, 3], 5], expected: [1, 2, 3] },
        { description: 'take zero', input: [[1, 2, 3], 0], expected: [] },
        { description: 'take negative', input: [[1, 2, 3], -1], expected: [] },
        { description: 'take one', input: [[1, 2, 3], 1], expected: [1] },
        { description: 'empty array', input: [[], 3], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'slice', 'take', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 38: Last N Elements
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Get Last N Elements',
    description: 'Create a function that returns last n elements of an array',
    prompt: `Write a TypeScript function \`takeLast<T>(arr: T[], n: number): T[]\` that:
- Returns last n elements of array
- Returns entire array if n >= array length
- Returns empty array if n <= 0
- Include JSDoc comments`,
    solution: `/**
 * Returns last n elements of an array
 * @param arr - Source array
 * @param n - Number of elements to take
 * @returns Array of last n elements
 */
function takeLast<T>(arr: T[], n: number): T[] {
  if (n <= 0) return [];
  return arr.slice(-n);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'take some', input: [[1, 2, 3, 4, 5], 3], expected: [3, 4, 5] },
        { description: 'take all', input: [[1, 2, 3], 5], expected: [1, 2, 3] },
        { description: 'take zero', input: [[1, 2, 3], 0], expected: [] },
        { description: 'take negative', input: [[1, 2, 3], -1], expected: [] },
        { description: 'take one', input: [[1, 2, 3], 1], expected: [3] },
        { description: 'empty array', input: [[], 3], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'slice', 'take-last', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 39: Absolute Value
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Calculate Absolute Value',
    description: 'Create a function that returns absolute value of a number',
    prompt: `Write a TypeScript function \`absolute(num: number): number\` that:
- Returns absolute value of the number
- Works with positive, negative, and zero
- Uses Math.abs()
- Include JSDoc comments`,
    solution: `/**
 * Returns absolute value of a number
 * @param num - Input number
 * @returns Absolute value
 */
function absolute(num: number): number {
  return Math.abs(num);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'positive', input: 5, expected: 5 },
        { description: 'negative', input: -5, expected: 5 },
        { description: 'zero', input: 0, expected: 0 },
        { description: 'decimal positive', input: 3.14, expected: 3.14 },
        { description: 'decimal negative', input: -3.14, expected: 3.14 },
        { description: 'large negative', input: -1000, expected: 1000 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'absolute', 'abs'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 40: Array Intersection
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Find Array Intersection',
    description: 'Create a function that finds common elements between two arrays',
    prompt: `Write a TypeScript function \`intersection<T>(arr1: T[], arr2: T[]): T[]\` that:
- Returns elements that exist in both arrays
- Removes duplicates from result
- Preserves order from first array
- Include JSDoc comments`,
    solution: `/**
 * Finds common elements between two arrays
 * @param arr1 - First array
 * @param arr2 - Second array
 * @returns Elements present in both arrays
 */
function intersection<T>(arr1: T[], arr2: T[]): T[] {
  const set2 = new Set(arr2);
  return [...new Set(arr1.filter(item => set2.has(item)))];
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'simple intersection', input: [[1, 2, 3, 4], [2, 4, 5]], expected: [2, 4] },
        { description: 'no overlap', input: [[1, 2], [3, 4]], expected: [] },
        { description: 'complete overlap', input: [[1, 2, 3], [1, 2, 3]], expected: [1, 2, 3] },
        { description: 'with duplicates', input: [[1, 2, 2, 3], [2, 3]], expected: [2, 3] },
        { description: 'empty first', input: [[], [1, 2]], expected: [] },
        { description: 'empty second', input: [[1, 2], []], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'set', 'intersection', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 41: Factorial
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Calculate Factorial',
    description: 'Create a function that calculates factorial of a number',
    prompt: `Write a TypeScript function \`factorial(n: number): number\` that:
- Returns factorial of n (n!)
- Returns 1 for n = 0 or n = 1
- Returns 0 for negative numbers (invalid input)
- Uses iterative approach (not recursive)
- Include JSDoc comments`,
    solution: `/**
 * Calculates factorial of a number
 * @param n - Non-negative integer
 * @returns Factorial of n
 */
function factorial(n: number): number {
  if (n < 0) return 0;
  if (n === 0 || n === 1) return 1;

  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'factorial of 0', input: 0, expected: 1 },
        { description: 'factorial of 1', input: 1, expected: 1 },
        { description: 'factorial of 5', input: 5, expected: 120 },
        { description: 'factorial of 3', input: 3, expected: 6 },
        { description: 'factorial of 7', input: 7, expected: 5040 },
        { description: 'negative input', input: -5, expected: 0 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 15,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'factorial', 'iteration'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 42: Is Prime
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Check Prime Number',
    description: 'Create a function that checks if a number is prime',
    prompt: `Write a TypeScript function \`isPrime(n: number): boolean\` that:
- Returns true if n is a prime number
- Returns false for n <= 1
- Returns false for non-integers
- Uses efficient algorithm (check up to sqrt(n))
- Include JSDoc comments`,
    solution: `/**
 * Checks if a number is prime
 * @param n - Number to check
 * @returns true if prime, false otherwise
 */
function isPrime(n: number): boolean {
  if (n <= 1 || !Number.isInteger(n)) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;

  for (let i = 3; i <= Math.sqrt(n); i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'prime 2', input: 2, expected: true },
        { description: 'prime 7', input: 7, expected: true },
        { description: 'prime 13', input: 13, expected: true },
        { description: 'not prime 4', input: 4, expected: false },
        { description: 'not prime 9', input: 9, expected: false },
        { description: 'one', input: 1, expected: false },
        { description: 'zero', input: 0, expected: false },
        { description: 'negative', input: -7, expected: false },
        { description: 'decimal', input: 5.5, expected: false },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 18,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'prime', 'algorithm'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 43: Shuffle Array
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Shuffle Array Randomly',
    description: 'Create a function that randomly shuffles an array',
    prompt: `Write a TypeScript function \`shuffle<T>(arr: T[]): T[]\` that:
- Returns new array with elements in random order
- Uses Fisher-Yates shuffle algorithm
- Does not modify original array
- Include JSDoc comments`,
    solution: `/**
 * Randomly shuffles an array
 * @param arr - Array to shuffle
 * @returns Shuffled array
 */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'array length preserved', input: [1, 2, 3, 4, 5], expected: 'length-5' },
        { description: 'all elements preserved', input: [1, 2, 3], expected: 'contains-all' },
        { description: 'empty array', input: [], expected: [] },
        { description: 'single element', input: [42], expected: [42] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 15,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'random', 'shuffle', 'algorithm', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 44: Group By
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Group Array Elements',
    description: 'Create a function that groups array elements by a key',
    prompt: `Write a TypeScript function \`groupBy<T, K extends keyof T>(arr: T[], key: K): Record<string, T[]>\` that:
- Groups array elements by the value of specified key
- Returns object where keys are the unique values and values are arrays of elements
- Handles empty arrays
- Include JSDoc comments`,
    solution: `/**
 * Groups array elements by a key
 * @param arr - Array to group
 * @param key - Key to group by
 * @returns Object with grouped elements
 */
function groupBy<T, K extends keyof T>(arr: T[], key: K): Record<string, T[]> {
  return arr.reduce((groups, item) => {
    const groupKey = String(item[key]);
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(item);
    return groups;
  }, {} as Record<string, T[]>);
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'group by category', input: [[{name: 'a', cat: 'x'}, {name: 'b', cat: 'y'}, {name: 'c', cat: 'x'}], 'cat'], expected: {x: [{name: 'a', cat: 'x'}, {name: 'c', cat: 'x'}], y: [{name: 'b', cat: 'y'}]} },
        { description: 'empty array', input: [[], 'key'], expected: {} },
        { description: 'single group', input: [[{id: 1, type: 'a'}, {id: 2, type: 'a'}], 'type'], expected: {a: [{id: 1, type: 'a'}, {id: 2, type: 'a'}]} },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 18,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'object', 'group-by', 'reduce', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 45: Zip Arrays
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Zip Two Arrays',
    description: 'Create a function that zips two arrays into array of pairs',
    prompt: `Write a TypeScript function \`zip<T, U>(arr1: T[], arr2: U[]): [T, U][]\` that:
- Pairs elements from two arrays at same indices
- Stops at length of shorter array
- Returns empty array if either input is empty
- Include JSDoc comments`,
    solution: `/**
 * Zips two arrays into array of pairs
 * @param arr1 - First array
 * @param arr2 - Second array
 * @returns Array of tuples pairing elements
 */
function zip<T, U>(arr1: T[], arr2: U[]): [T, U][] {
  const length = Math.min(arr1.length, arr2.length);
  const result: [T, U][] = [];

  for (let i = 0; i < length; i++) {
    result.push([arr1[i], arr2[i]]);
  }

  return result;
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'equal length', input: [[1, 2, 3], ['a', 'b', 'c']], expected: [[1, 'a'], [2, 'b'], [3, 'c']] },
        { description: 'first shorter', input: [[1, 2], ['a', 'b', 'c']], expected: [[1, 'a'], [2, 'b']] },
        { description: 'second shorter', input: [[1, 2, 3], ['a', 'b']], expected: [[1, 'a'], [2, 'b']] },
        { description: 'empty first', input: [[], ['a', 'b']], expected: [] },
        { description: 'empty second', input: [[1, 2], []], expected: [] },
        { description: 'both empty', input: [[], []], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 18,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'zip', 'tuple', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 46: Partition Array
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Partition Array by Predicate',
    description: 'Create a function that partitions array into two based on predicate',
    prompt: `Write a TypeScript function \`partition<T>(arr: T[], predicate: (item: T) => boolean): [T[], T[]]\` that:
- Splits array into two: [items matching predicate, items not matching]
- Preserves order in both partitions
- Returns tuple of two arrays
- Include JSDoc comments`,
    solution: `/**
 * Partitions array by predicate
 * @param arr - Array to partition
 * @param predicate - Function to test each element
 * @returns Tuple of [matching, not matching]
 */
function partition<T>(arr: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const matching: T[] = [];
  const notMatching: T[] = [];

  arr.forEach(item => {
    if (predicate(item)) {
      matching.push(item);
    } else {
      notMatching.push(item);
    }
  });

  return [matching, notMatching];
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'partition evens', input: [[1, 2, 3, 4, 5, 6], (x: number) => x % 2 === 0], expected: [[2, 4, 6], [1, 3, 5]] },
        { description: 'all match', input: [[2, 4, 6], (x: number) => x % 2 === 0], expected: [[2, 4, 6], []] },
        { description: 'none match', input: [[1, 3, 5], (x: number) => x % 2 === 0], expected: [[], [1, 3, 5]] },
        { description: 'empty array', input: [[], (x: number) => x > 0], expected: [[], []] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 20,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'partition', 'filter', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 47: Rotate Array
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Rotate Array Left',
    description: 'Create a function that rotates array left by n positions',
    prompt: `Write a TypeScript function \`rotateLeft<T>(arr: T[], n: number): T[]\` that:
- Rotates array to the left by n positions
- Returns new array (don't modify original)
- Handles n larger than array length (use modulo)
- Handles negative n (treat as rotate right)
- Include JSDoc comments`,
    solution: `/**
 * Rotates array to the left by n positions
 * @param arr - Array to rotate
 * @param n - Number of positions to rotate
 * @returns Rotated array
 */
function rotateLeft<T>(arr: T[], n: number): T[] {
  if (arr.length === 0) return [];
  const positions = ((n % arr.length) + arr.length) % arr.length;
  return [...arr.slice(positions), ...arr.slice(0, positions)];
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'rotate by 1', input: [[1, 2, 3, 4, 5], 1], expected: [2, 3, 4, 5, 1] },
        { description: 'rotate by 2', input: [[1, 2, 3, 4, 5], 2], expected: [3, 4, 5, 1, 2] },
        { description: 'rotate by length', input: [[1, 2, 3], 3], expected: [1, 2, 3] },
        { description: 'rotate by more than length', input: [[1, 2, 3], 5], expected: [3, 1, 2] },
        { description: 'negative rotation', input: [[1, 2, 3, 4, 5], -1], expected: [5, 1, 2, 3, 4] },
        { description: 'empty array', input: [[], 3], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['array', 'rotate', 'slice', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 48: Memoize Function
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Memoize Single-Argument Function',
    description: 'Create a function that memoizes another function',
    prompt: `Write a TypeScript function \`memoize<T, R>(fn: (arg: T) => R): (arg: T) => R\` that:
- Returns memoized version of input function
- Caches results based on argument
- Works with single-argument functions
- Uses Map for caching
- Include JSDoc comments`,
    solution: `/**
 * Memoizes a single-argument function
 * @param fn - Function to memoize
 * @returns Memoized function
 */
function memoize<T, R>(fn: (arg: T) => R): (arg: T) => R {
  const cache = new Map<T, R>();

  return (arg: T): R => {
    if (cache.has(arg)) {
      return cache.get(arg)!;
    }
    const result = fn(arg);
    cache.set(arg, result);
    return result;
  };
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'caches result', input: (x: number) => x * 2, expected: 'cached' },
        { description: 'different inputs', input: (x: number) => x + 1, expected: 'multiple-cached' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 18,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['function', 'memoization', 'cache', 'map', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 49: Debounce Function
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Debounce Function',
    description: 'Create a debounce function that delays execution',
    prompt: `Write a TypeScript function \`debounce<T extends any[]>(fn: (...args: T) => void, delay: number): (...args: T) => void\` that:
- Returns debounced version of input function
- Delays execution until delay milliseconds have passed without calls
- Clears previous timeout on each call
- Include JSDoc comments`,
    solution: `/**
 * Debounces a function
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
function debounce<T extends any[]>(fn: (...args: T) => void, delay: number): (...args: T) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: T) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'delays execution', input: [() => {}, 100], expected: 'debounced' },
        { description: 'cancels previous', input: [() => {}, 100], expected: 'debounced' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 18,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['function', 'debounce', 'setTimeout', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 50: Throttle Function
  {
    language: 'typescript',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Throttle Function',
    description: 'Create a throttle function that limits execution rate',
    prompt: `Write a TypeScript function \`throttle<T extends any[]>(fn: (...args: T) => void, limit: number): (...args: T) => void\` that:
- Returns throttled version of input function
- Allows execution at most once per limit milliseconds
- Ignores calls during cooldown period
- Include JSDoc comments`,
    solution: `/**
 * Throttles a function
 * @param fn - Function to throttle
 * @param limit - Minimum time between calls in milliseconds
 * @returns Throttled function
 */
function throttle<T extends any[]>(fn: (...args: T) => void, limit: number): (...args: T) => void {
  let inThrottle = false;

  return (...args: T) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}`,
    testSuite: {
      framework: 'vitest',
      tests: [
        { description: 'limits execution', input: [() => {}, 100], expected: 'throttled' },
        { description: 'allows after cooldown', input: [() => {}, 100], expected: 'throttled' },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 20,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['function', 'throttle', 'setTimeout', 'generics'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },
]
