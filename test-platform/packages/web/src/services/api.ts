import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787'

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important for cookie-based auth
})

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Token will be sent via httpOnly cookies
    // No need to manually attach it here
    return config
  },
  (error: AxiosError) => {
    return Promise.reject(error)
  }
)

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    return response
  },
  (error: AxiosError) => {
    // Handle common errors
    if (error.response) {
      const status = error.response.status

      switch (status) {
        case 401:
          // Unauthorized - redirect to login
          if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
            window.location.href = '/login'
          }
          break
        case 403:
          // Forbidden - user doesn't have permission
          console.error('Access forbidden:', error.response.data)
          break
        case 404:
          // Not found
          console.error('Resource not found:', error.response.data)
          break
        case 500:
          // Server error
          console.error('Server error:', error.response.data)
          break
        default:
          console.error('API error:', error.response.data)
      }
    } else if (error.request) {
      // Request was made but no response received
      console.error('Network error:', error.message)
    } else {
      // Something else happened
      console.error('Error:', error.message)
    }

    return Promise.reject(error)
  }
)

export default apiClient

// Helper function to extract error message
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message || error.response?.data?.error
    if (message) return message
    if (error.response?.status) {
      return `Request failed with status ${error.response.status}`
    }
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred'
}
