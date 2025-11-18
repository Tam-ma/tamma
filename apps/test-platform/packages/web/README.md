# Tamma Test Platform - Web Frontend

Frontend application for the Tamma Test Platform built with Next.js 15, React 19, and TypeScript.

## Features

### API Key Management UI (Story 1.2 - Task 5)

Complete API key management implementation including:

- **API Keys Dashboard**: List, search, filter, and sort API keys
- **Generate Key Wizard**: 4-step modal for creating new API keys
  - Step 1: Key Configuration (name, description)
  - Step 2: Permissions & Scopes (6 available scopes with descriptions)
  - Step 3: Expiration & Security (IP whitelist, expiration options)
  - Step 4: Review & Confirm
- **Key Generated Modal**: One-time display of full API key with security warnings
- **Key Details Modal**: Tabbed interface for managing existing keys
  - Details Tab: View/edit key information
  - Usage Tab: Analytics charts and usage statistics
  - Security Tab: IP whitelist, security events, revoke option
- **Usage Dashboard**: Charts and metrics powered by Recharts
- **Revoke Key Modal**: Confirmation dialog with consequences
- **Summary Statistics**: Total keys, active keys, requests, success rate

### Password Management UI (Story 1.2)

Complete password management implementation including:

- Forgot Password flow with email verification
- Reset Password with token validation
- Password strength meter and requirements checklist
- Change Password for authenticated users
- Comprehensive error handling and user feedback
- Responsive design with Tailwind CSS
- Accessibility features (WCAG 2.1 AA compliant)

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **React**: React 19
- **TypeScript**: 5.3+
- **Styling**: Tailwind CSS 3.4
- **State Management**: TanStack Query (React Query) v5
- **Form Management**: React Hook Form 7.53
- **Validation**: Zod 3.23
- **Charts**: Recharts 2.12
- **Date Handling**: date-fns 4.1
- **Icons**: Lucide React 0.454
- **HTTP Client**: Axios 1.7
- **Testing**: Jest + React Testing Library

## Project Structure

```
packages/web/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── layout.tsx           # Root layout with providers
│   │   ├── providers/           # React Query and other providers
│   │   └── settings/
│   │       └── api-keys/        # API Keys page route
│   │           └── page.tsx
│   ├── components/
│   │   ├── api-keys/            # API Key components
│   │   │   ├── GenerateKeyModal.tsx      # 4-step wizard
│   │   │   ├── KeyGeneratedModal.tsx     # One-time key display
│   │   │   ├── KeyDetailsModal.tsx       # Tabbed details view
│   │   │   ├── RevokeKeyModal.tsx        # Revoke confirmation
│   │   │   └── UsageDashboard.tsx        # Usage charts
│   │   └── ui/                  # Shared UI components
│   │       ├── Modal.tsx        # Base modal component
│   │       └── Badge.tsx        # Badge/status components
│   ├── pages/
│   │   └── settings/
│   │       └── APIKeysPage.tsx  # Main API keys management page
│   ├── hooks/
│   │   └── useAPIKeys.ts        # React Query hooks for API keys
│   ├── services/
│   │   └── api-key.service.ts   # API key service layer
│   ├── types/
│   │   └── api-key.types.ts     # TypeScript type definitions
│   ├── lib/
│   │   └── api-client.ts        # Axios API client
│   └── styles/
│       └── globals.css          # Global styles and Tailwind
├── __tests__/                   # Test files
│   └── components/
│       └── APIKeysPage.test.tsx
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── next.config.js
├── jest.config.js
└── README.md
```

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
cd packages/web
npm install
cp .env.example .env.local
```

### Environment Variables

Create a `.env.local` file:

```bash
API_BASE_URL=http://localhost:3000/api
NODE_ENV=development
```

### Development

```bash
npm run dev       # Start development server on http://localhost:3000
npm run test      # Run tests with Jest
npm run lint      # Run ESLint
npm run type-check # TypeScript type checking
```

### Build

```bash
npm run build     # Build for production
npm run start     # Start production server
```

## API Key Management Features

### Available Scopes

- `read:tests` - View test configurations and details
- `write:tests` - Create, update, and delete tests
- `read:results` - View test execution results
- `write:results` - Submit test results
- `read:benchmarks` - View benchmark data and analytics
- `write:benchmarks` - Create and update benchmark configurations

### Security Features

- **One-time Key Display**: Full API key shown only once during creation
- **Key Prefix Display**: Only first 8 characters shown in listings
- **IP Whitelist**: Optional IP address/CIDR range restrictions
- **Rate Limiting**: Configurable requests per hour (100-10,000)
- **Expiration Options**: 30 days, 90 days, 1 year, or never
- **Audit Logging**: All actions logged for security events
- **Revocation**: Immediate key revocation with confirmation

### Usage Analytics

- **Requests Over Time**: Line chart showing request volume
- **Usage by Endpoint**: Bar chart of endpoint usage
- **Key Metrics**:
  - Total requests
  - Average requests per day
  - Success rate percentage
  - Error count and rate
- **Recent Requests**: Table of latest API calls with status codes
- **Security Events**: Log of security-related events

## API Integration

### Backend Endpoints

API key endpoints:
- `GET /api/auth/api-keys` - List all API keys
- `POST /api/auth/api-keys` - Create new API key
- `GET /api/auth/api-keys/:id` - Get key details
- `PATCH /api/auth/api-keys/:id` - Update key
- `DELETE /api/auth/api-keys/:id` - Revoke key
- `GET /api/auth/api-keys/:id/usage` - Get usage statistics

Password endpoints:
- `POST /api/auth/password/reset-request` - Request password reset
- `POST /api/auth/password/reset` - Reset password with token
- `POST /api/auth/password/change` - Change password (authenticated)
- `GET /api/auth/password/validate-token` - Validate reset token

## Testing

```bash
npm run test              # Run all tests
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Generate coverage report
```

### Test Files

- `__tests__/components/APIKeysPage.test.tsx` - API Keys page tests
- More tests to be added for modals and hooks

## Accessibility Features

All components follow WCAG 2.1 AA standards:

- **Keyboard Navigation**: Full keyboard support with logical tab order
- **Screen Reader Support**: Proper ARIA labels and live regions
- **Focus Management**: Clear focus indicators and focus trapping in modals
- **Color Contrast**: All text meets contrast requirements
- **Semantic HTML**: Proper heading hierarchy and landmarks

## Component Architecture

### Modal Components

All modals use the base `Modal` component which provides:
- Escape key to close
- Click outside to close
- Focus trap within modal
- Scroll lock on body
- Customizable sizes (sm, md, lg, xl)

### State Management

- **Server State**: TanStack Query for API data caching and synchronization
- **Local State**: React hooks for UI state
- **Form State**: React Hook Form for form management

### Data Flow

1. User action triggers API call
2. React Query manages request/response
3. Cache automatically updated
4. Components re-render with fresh data
5. Optimistic updates for better UX

## Performance Optimizations

- **Code Splitting**: Dynamic imports for modals
- **Lazy Loading**: Charts loaded on-demand
- **Debounced Search**: 300ms debounce on search input
- **Virtualized Lists**: For large API key lists (future)
- **Memoization**: React.memo for expensive components
- **Query Caching**: Smart cache invalidation with React Query

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)

## Contributing

1. Create a feature branch
2. Make your changes
3. Add tests
4. Run linting and type checking
5. Submit a pull request

## License

MIT
