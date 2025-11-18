import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Utility function to merge Tailwind CSS classes with clsx
 * Handles conditional classes and prevents style conflicts
 *
 * @example
 * cn('px-2 py-1', condition && 'bg-blue-500', 'text-white')
 * cn({ 'bg-blue-500': isActive, 'bg-gray-500': !isActive })
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
