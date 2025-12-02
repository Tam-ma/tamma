/**
 * Test Bank Seed Data
 * Python - Code Generation - Easy Tasks
 */

import type { CreateTestBankTask } from '../../types/test-bank.types'
import { getCodeGenRoleEvaluations } from './role-evaluations'

export const pythonCodeGenEasyTasks: CreateTestBankTask[] = [
  // Task 1: Email Validation
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Email Validation Function',
    description: 'Create a function that validates email addresses using regex',
    prompt: `Write a Python function 
validate_email(email: str) -> bool
 that:
- Returns True if email is valid (basic RFC 5322 check)
- Returns False otherwise
- Handles edge cases: empty string, whitespace, missing @ symbol
- Include docstring
- Use type hints`,
    solution: `import re

def validate_email(email: str) -> bool:
    """
    Validates email addresses using regex
    :param email: Email string to validate
    :return: True if valid, False otherwise
    """
    if not email or not email.strip():
        return False
    regex = r'^[^\s@]+@[^\s@]+\.[^\s@]+$'
    return bool(re.match(regex, email.strip()))`,
    testSuite: {
      framework: 'pytest',
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
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Capitalize First Letter',
    description: 'Create a function that capitalizes the first letter of a string',
    prompt: `Write a Python function 
capitalize_string(s: str) -> str
 that:
- Capitalizes the first letter of the input string
- Lowercases all other letters
- Handles empty strings
- Handles strings with leading whitespace
- Include docstring
- Use type hints`,
    solution: `def capitalize_string(s: str) -> str:
    """
    Capitalizes the first letter of a string
    :param s: Input string
    :return: String with first letter capitalized
    """
    if not s:
        return ""
    trimmed = s.strip()
    if not trimmed:
        return trimmed
    return trimmed[0].upper() + trimmed[1:].lower()`,
    testSuite: {
      framework: 'pytest',
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

  // Task 3: Sum List
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Sum List Numbers',
    description: 'Create a function that calculates the sum of numbers in a list',
    prompt: `Write a Python function 
sum_numbers(numbers: list[float]) -> float
 that:
- Returns the sum of all numbers in the list
- Returns 0 for empty lists
- Uses built-in functions where appropriate
- Include docstring
- Use type hints`,
    solution: `def sum_numbers(numbers: list[float]) -> float:
    """
    Calculates the sum of all numbers in a list
    :param numbers: List of numbers to sum
    :return: Sum of all numbers
    """
    return sum(numbers)`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'positive numbers', input: [1, 2, 3, 4, 5], expected: 15 },
        { description: 'negative numbers', input: [-1, -2, -3], expected: -6 },
        { description: 'mixed numbers', input: [1, -2, 3, -4], expected: -2 },
        { description: 'single number', input: [42], expected: 42 },
        { description: 'empty list', input: [], expected: 0 },
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
    tags: ['list', 'sum', 'math'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 4: Is Even Number
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Check Even Number',
    description: 'Create a function that checks if a number is even',
    prompt: `Write a Python function 
is_even(n: int) -> bool
 that:
- Returns True if the number is even
- Returns False if the number is odd
- Handles negative numbers correctly
- Include docstring
- Use type hints`,
    solution: `def is_even(n: int) -> bool:
    """
    Checks if a number is even
    :param n: Number to check
    :return: True if even, False if odd
    """
    return n % 2 == 0`,
    testSuite: {
      framework: 'pytest',
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
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Reverse String',
    description: 'Create a function that reverses a string',
    prompt: `Write a Python function 
reverse_string(s: str) -> str
 that:
- Returns the input string reversed
- Handles empty strings
- Uses pythonic slicing
- Include docstring
- Use type hints`,
    solution: `def reverse_string(s: str) -> str:
    """
    Reverses a string
    :param s: String to reverse
    :return: Reversed string
    """
    return s[::-1]`,
    testSuite: {
      framework: 'pytest',
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
    tags: ['string-manipulation', 'slicing'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 6: Find Maximum
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Find Maximum Number',
    description: 'Create a function that finds the maximum number in a list',
    prompt: `Write a Python function 
find_max(numbers: list[float]) -> float | None
 that:
- Returns the largest number in the list
- Returns None for empty lists
- Handles negative numbers
- Include docstring
- Use type hints`,
    solution: `from typing import List, Optional, Union

def find_max(numbers: List[Union[int, float]]) -> Optional[Union[int, float]]:
    """
    Finds the maximum number in a list
    :param numbers: List of numbers
    :return: Maximum number or None if list is empty
    """
    if not numbers:
        return None
    return max(numbers)`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'positive numbers', input: [1, 5, 3, 9, 2], expected: 9 },
        { description: 'negative numbers', input: [-5, -1, -10, -3], expected: -1 },
        { description: 'mixed numbers', input: [-5, 10, -2, 8], expected: 10 },
        { description: 'single number', input: [42], expected: 42 },
        { description: 'empty list', input: [], expected: null },
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
    tags: ['list', 'math', 'max'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 7: Count Vowels
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Count Vowels',
    description: 'Create a function that counts vowels in a string',
    prompt: `Write a Python function 
count_vowels(s: str) -> int
 that:
- Returns the count of vowels (a, e, i, o, u) in the string
- Is case-insensitive
- Handles empty strings
- Include docstring
- Use type hints`,
    solution: `def count_vowels(s: str) -> int:
    """
    Counts the number of vowels in a string
    :param s: Input string
    :return: Number of vowels
    """
    vowels = 'aeiouAEIOU'
    return sum(1 for char in s if char in vowels)`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'lowercase', input: 'hello', expected: 2 },
        { description: 'uppercase', input: 'WORLD', expected: 1 },
        { description: 'mixed case', input: 'Python', expected: 1 },
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
    tags: ['string-manipulation', 'counting', 'list-comprehension'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 8: Is Palindrome
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Check Palindrome',
    description: 'Create a function that checks if a string is a palindrome',
    prompt: `Write a Python function 
is_palindrome(s: str) -> bool
 that:
- Returns True if the string is a palindrome (reads same forwards and backwards)
- Is case-insensitive
- Ignores spaces and punctuation
- Include docstring
- Use type hints`,
    solution: `import re

def is_palindrome(s: str) -> bool:
    """
    Checks if a string is a palindrome
    :param s: Input string
    :return: True if palindrome, False otherwise
    """
    cleaned = re.sub(r'[^a-z0-9]', '', s.lower())
    return cleaned == cleaned[::-1]`,
    testSuite: {
      framework: 'pytest',
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
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Filter Even Numbers',
    description: 'Create a function that filters even numbers from a list',
    prompt: `Write a Python function 
filter_even(numbers: list[int]) -> list[int]
 that:
- Returns a new list containing only even numbers
- Preserves the original order
- Returns empty list if no even numbers found
- Include docstring
- Use type hints`,
    solution: `from typing import List

def filter_even(numbers: List[int]) -> List[int]:
    """
    Filters even numbers from a list
    :param numbers: List of numbers
    :return: List containing only even numbers
    """
    return [n for n in numbers if n % 2 == 0]`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'mixed numbers', input: [1, 2, 3, 4, 5, 6], expected: [2, 4, 6] },
        { description: 'all even', input: [2, 4, 6], expected: [2, 4, 6] },
        { description: 'all odd', input: [1, 3, 5], expected: [] },
        { description: 'negative numbers', input: [-2, -1, 0, 1, 2], expected: [-2, 0, 2] },
        { description: 'empty list', input: [], expected: [] },
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
    tags: ['list', 'filter', 'even-numbers', 'list-comprehension'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 10: Repeat String
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Repeat String',
    description: 'Create a function that repeats a string n times',
    prompt: `Write a Python function 
repeat_string(s: str, times: int) -> str
 that:
- Returns the string repeated the specified number of times
- Returns empty string if times is 0 or negative
- Handles empty input strings
- Include docstring
- Use type hints`,
    solution: `def repeat_string(s: str, times: int) -> str:
    """
    Repeats a string n times
    :param s: String to repeat
    :param times: Number of times to repeat
    :return: Repeated string
    """
    if times <= 0:
        return ""
    return s * times`,
    testSuite: {
      framework: 'pytest',
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
    tags: ['string-manipulation', 'repeat', 'operator-overloading'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 11: Remove Duplicates
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Remove Duplicate List Elements',
    description: 'Create a function that removes duplicate values from a list',
    prompt: `Write a Python function \`remove_duplicates(items: list) -> list\` that:
- Returns a new list with duplicates removed
- Preserves the order of first occurrence
- Works with any hashable elements
- Include docstring
- Use type hints`,
    solution: `from typing import List, Any

def remove_duplicates(items: List[Any]) -> List[Any]:
    """
    Removes duplicate values from a list
    :param items: List with potential duplicates
    :return: List with duplicates removed
    """
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'numbers with duplicates', input: [1, 2, 2, 3, 4, 4, 5], expected: [1, 2, 3, 4, 5] },
        { description: 'strings with duplicates', input: ['a', 'b', 'a', 'c'], expected: ['a', 'b', 'c'] },
        { description: 'no duplicates', input: [1, 2, 3], expected: [1, 2, 3] },
        { description: 'all duplicates', input: [1, 1, 1], expected: [1] },
        { description: 'empty list', input: [], expected: [] },
        { description: 'single element', input: [42], expected: [42] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['list', 'set', 'deduplication'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 12: Truncate String
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Truncate String with Ellipsis',
    description: 'Create a function that truncates a string to a maximum length',
    prompt: `Write a Python function \`truncate_string(s: str, max_length: int) -> str\` that:
- Returns the string if it's shorter than max_length
- Truncates and adds "..." if longer than max_length (ellipsis counts toward max_length)
- Handles edge cases: empty string, max_length < 3
- Include docstring
- Use type hints`,
    solution: `def truncate_string(s: str, max_length: int) -> str:
    """
    Truncates a string to maximum length with ellipsis
    :param s: String to truncate
    :param max_length: Maximum length including ellipsis
    :return: Truncated string
    """
    if len(s) <= max_length:
        return s
    if max_length < 3:
        return s[:max_length]
    return s[:max_length - 3] + '...'`,
    testSuite: {
      framework: 'pytest',
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
    tags: ['string-manipulation', 'truncate', 'slicing'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 13: Chunk List
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Chunk List into Groups',
    description: 'Create a function that splits a list into chunks of specified size',
    prompt: `Write a Python function \`chunk_list(items: list, size: int) -> list[list]\` that:
- Returns list split into chunks of given size
- Last chunk may be smaller if elements don't divide evenly
- Returns empty list for empty input
- Handles size <= 0 by returning empty list
- Include docstring
- Use type hints`,
    solution: `from typing import List, Any

def chunk_list(items: List[Any], size: int) -> List[List[Any]]:
    """
    Splits a list into chunks of specified size
    :param items: List to chunk
    :param size: Size of each chunk
    :return: List of chunks
    """
    if size <= 0:
        return []
    return [items[i:i + size] for i in range(0, len(items), size)]`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'even division', input: [[1, 2, 3, 4, 5, 6], 2], expected: [[1, 2], [3, 4], [5, 6]] },
        { description: 'uneven division', input: [[1, 2, 3, 4, 5], 2], expected: [[1, 2], [3, 4], [5]] },
        { description: 'chunk size 1', input: [[1, 2, 3], 1], expected: [[1], [2], [3]] },
        { description: 'chunk larger than list', input: [[1, 2], 5], expected: [[1, 2]] },
        { description: 'empty list', input: [[], 2], expected: [] },
        { description: 'size 0', input: [[1, 2, 3], 0], expected: [] },
        { description: 'negative size', input: [[1, 2, 3], -1], expected: [] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['list', 'chunking', 'list-comprehension', 'slicing'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 14: Flatten List
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Flatten Nested List (One Level)',
    description: 'Create a function that flattens a nested list by one level',
    prompt: `Write a Python function \`flatten_list(items: list) -> list\` that:
- Flattens nested list by exactly one level
- Returns new list with all sub-list elements concatenated
- Handles mixed types (only flattens lists)
- Include docstring
- Use type hints`,
    solution: `from typing import List, Any

def flatten_list(items: List[Any]) -> List[Any]:
    """
    Flattens a nested list by one level
    :param items: List to flatten
    :return: Flattened list
    """
    result = []
    for item in items:
        if isinstance(item, list):
            result.extend(item)
        else:
            result.append(item)
    return result`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'simple nested', input: [[1, 2], [3, 4], [5]], expected: [1, 2, 3, 4, 5] },
        { description: 'mixed elements', input: [1, [2, 3], 4, [5]], expected: [1, 2, 3, 4, 5] },
        { description: 'empty sub-lists', input: [[1], [], [2, 3]], expected: [1, 2, 3] },
        { description: 'all empty', input: [[], [], []], expected: [] },
        { description: 'no nesting', input: [1, 2, 3], expected: [1, 2, 3] },
        { description: 'single nested', input: [[1, 2, 3]], expected: [1, 2, 3] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['list', 'flatten', 'iteration'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 15: Get Unique Values
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Get Unique Values from Multiple Lists',
    description: 'Create a function that returns unique values from multiple lists',
    prompt: `Write a Python function \`get_unique(*lists: list) -> list\` that:
- Accepts multiple lists as arguments
- Returns list of unique values across all input lists
- Preserves order of first occurrence
- Include docstring
- Use type hints`,
    solution: `from typing import List, Any

def get_unique(*lists: List[Any]) -> List[Any]:
    """
    Gets unique values from multiple lists
    :param lists: Multiple lists to process
    :return: List of unique values
    """
    seen = set()
    result = []
    for lst in lists:
        for item in lst:
            if item not in seen:
                seen.add(item)
                result.append(item)
    return result`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'two lists', input: [[1, 2], [2, 3]], expected: [1, 2, 3] },
        { description: 'three lists', input: [[1, 2], [2, 3], [3, 4]], expected: [1, 2, 3, 4] },
        { description: 'no overlap', input: [[1, 2], [3, 4]], expected: [1, 2, 3, 4] },
        { description: 'all same', input: [[1, 1], [1, 1]], expected: [1] },
        { description: 'empty lists', input: [[], []], expected: [] },
        { description: 'single list', input: [[1, 2, 2, 3]], expected: [1, 2, 3] },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 12,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['list', 'set', 'variadic', 'deduplication'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 16: String to Title Case
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Convert to Title Case',
    description: 'Create a function that converts a string to title case',
    prompt: `Write a Python function \`to_title_case(s: str) -> str\` that:
- Capitalizes first letter of each word
- Lowercases all other letters
- Treats spaces as word separators
- Handles empty strings and single words
- Include docstring
- Use type hints`,
    solution: `def to_title_case(s: str) -> str:
    """
    Converts a string to title case
    :param s: Input string
    :return: Title-cased string
    """
    if not s:
        return ""
    return ' '.join(word.capitalize() for word in s.split(' '))`,
    testSuite: {
      framework: 'pytest',
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
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['string-manipulation', 'formatting', 'capitalize'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 17: Calculate Average
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Calculate Average of Numbers',
    description: 'Create a function that calculates the average of a list of numbers',
    prompt: `Write a Python function \`calculate_average(numbers: list[float]) -> float\` that:
- Returns the arithmetic mean of the numbers
- Returns 0 for empty lists
- Handles negative numbers and decimals
- Include docstring
- Use type hints`,
    solution: `from typing import List, Union

def calculate_average(numbers: List[Union[int, float]]) -> float:
    """
    Calculates the average of a list of numbers
    :param numbers: List of numbers
    :return: Average value
    """
    if not numbers:
        return 0
    return sum(numbers) / len(numbers)`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'positive integers', input: [1, 2, 3, 4, 5], expected: 3 },
        { description: 'with decimals', input: [1.5, 2.5, 3.5], expected: 2.5 },
        { description: 'negative numbers', input: [-2, -4, -6], expected: -4 },
        { description: 'mixed numbers', input: [-1, 0, 1], expected: 0 },
        { description: 'single number', input: [42], expected: 42 },
        { description: 'empty list', input: [], expected: 0 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['math', 'list', 'sum', 'len'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 18: Deep Clone Dictionary
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Deep Copy Dictionary',
    description: 'Create a function that deep copies a dictionary',
    prompt: `Write a Python function \`deep_copy_dict(d: dict) -> dict\` that:
- Creates a deep copy of a dictionary
- Works with nested dictionaries and lists
- Uses copy module
- Include docstring
- Use type hints`,
    solution: `import copy
from typing import Dict, Any

def deep_copy_dict(d: Dict[Any, Any]) -> Dict[Any, Any]:
    """
    Creates a deep copy of a dictionary
    :param d: Dictionary to copy
    :return: Deep copied dictionary
    """
    return copy.deepcopy(d)`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'simple dict', input: {'a': 1, 'b': 2}, expected: {'a': 1, 'b': 2} },
        { description: 'nested dict', input: {'a': {'b': {'c': 1}}}, expected: {'a': {'b': {'c': 1}}} },
        { description: 'with list', input: {'arr': [1, 2, 3]}, expected: {'arr': [1, 2, 3]} },
        { description: 'empty dict', input: {}, expected: {} },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['dict', 'copy', 'deepcopy'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 19: Swap Key-Value Pairs
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Swap Dictionary Keys and Values',
    description: 'Create a function that swaps keys and values in a dictionary',
    prompt: `Write a Python function \`swap_key_value(d: dict[str, str]) -> dict[str, str]\` that:
- Returns new dictionary with keys and values swapped
- Handles empty dictionaries
- Assumes all values are hashable and unique
- Include docstring
- Use type hints`,
    solution: `from typing import Dict

def swap_key_value(d: Dict[str, str]) -> Dict[str, str]:
    """
    Swaps keys and values in a dictionary
    :param d: Dictionary with string values
    :return: New dictionary with swapped keys and values
    """
    return {v: k for k, v in d.items()}`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'simple dict', input: {'a': 'x', 'b': 'y'}, expected: {'x': 'a', 'y': 'b'} },
        { description: 'numeric values', input: {'one': '1', 'two': '2'}, expected: {'1': 'one', '2': 'two'} },
        { description: 'empty dict', input: {}, expected: {} },
        { description: 'single pair', input: {'key': 'value'}, expected: {'value': 'key'} },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 7.5,
      maxLines: 8,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['dict', 'transform', 'dict-comprehension'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Task 20: Find Index of Element
  {
    language: 'python',
    scenario: 'code-generation',
    difficulty: 'easy',
    title: 'Find First Index of Element',
    description: 'Create a function that finds the first index of an element',
    prompt: `Write a Python function \`find_index(items: list, element: Any) -> int\` that:
- Returns the first index where element is found
- Returns -1 if element is not found
- Include docstring
- Use type hints`,
    solution: `from typing import List, Any

def find_index(items: List[Any], element: Any) -> int:
    """
    Finds the first index of an element in a list
    :param items: List to search
    :param element: Element to find
    :return: Index of element or -1 if not found
    """
    try:
        return items.index(element)
    except ValueError:
        return -1`,
    testSuite: {
      framework: 'pytest',
      tests: [
        { description: 'element exists', input: [[1, 2, 3, 4], 3], expected: 2 },
        { description: 'element not found', input: [[1, 2, 3], 5], expected: -1 },
        { description: 'first occurrence', input: [[1, 2, 2, 3], 2], expected: 1 },
        { description: 'at start', input: [[5, 2, 3], 5], expected: 0 },
        { description: 'at end', input: [[1, 2, 5], 5], expected: 2 },
        { description: 'empty list', input: [[], 1], expected: -1 },
      ],
    },
    expectedMetrics: {
      testPassRate: 100,
      codeQualityMin: 8.0,
      maxLines: 10,
    },
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('easy'),
    tags: ['list', 'search', 'index', 'exception-handling'],
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },
]
