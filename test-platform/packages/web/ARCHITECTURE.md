# User Registration UI Architecture

## Component Hierarchy

```
App (BrowserRouter)
├── Routes
    ├── RegisterPage
    │   ├── FormField (x4)
    │   │   ├── Input (email)
    │   │   ├── Input (first/last name)
    │   │   ├── PasswordInput (password)
    │   │   │   └── Show/Hide Toggle Button
    │   │   └── PasswordInput (confirm password)
    │   ├── PasswordStrengthMeter
    │   └── RateLimitModal (conditional)
    │
    └── VerifyEmailPage
        └── Dynamic States:
            ├── Loading State
            ├── Success State (sent)
            ├── Success State (verified)
            ├── Already Verified State
            ├── Expired Token State
            └── Error State
```

## Data Flow

```
User Input
    ↓
React Hook Form (watch, register)
    ↓
Zod Schema Validation (real-time)
    ↓
Form State Updates
    ├→ Error Messages Display
    ├→ Password Strength Calculation
    └→ Submit Button Enable/Disable
    
On Submit:
    ↓
authService.register()
    ↓
API Request (Axios)
    ↓
Response Handler
    ├→ Success: navigate('/verify-email?sent=true')
    ├→ Error: Display error message
    └→ Rate Limit: Show RateLimitModal
```

## State Management

### RegisterPage State
- `isLoading: boolean` - Form submission state
- `error: string | null` - Error message
- `rateLimitSeconds: number | null` - Rate limit countdown
- Form state (React Hook Form):
  - `email: string`
  - `password: string`
  - `confirmPassword: string`
  - `firstName?: string`
  - `lastName?: string`
  - `errors: FieldErrors`
  - `isValid: boolean`

### VerifyEmailPage State
- `state: VerificationState` - Current page state
- `countdown: number` - Redirect countdown
- `email: string` - For resend functionality
- `resendLoading: boolean` - Resend button state
- `resendSuccess: boolean` - Resend success feedback

### RateLimitModal State
- `countdown: number` - Time remaining

## Validation Flow

```
Field Change
    ↓
Debounced Validation (React Hook Form)
    ↓
Zod Schema Check
    ↓
├─ Valid: Clear error
└─ Invalid: Set field error
    ↓
Update UI
    ├→ Show/Hide error message
    ├→ Add/Remove error styling
    └→ Update submit button state
```

## Password Strength Algorithm

```
Input: password string
    ↓
Calculate Score (0-7+)
    ├→ Length >= 12: +1
    ├→ Length >= 16: +1
    ├→ Contains lowercase: +1
    ├→ Contains uppercase: +1
    ├→ Contains number: +1
    ├→ Contains special char: +1
    └→ Unique chars > 8: +1
    ↓
Map Score to Strength
    ├→ 0-2: weak (red)
    ├→ 3-4: fair (orange)
    ├→ 5: good (yellow)
    └→ 6+: strong (green)
    ↓
Update Visual Meter
    ├→ Color bar
    ├→ Width (25%, 50%, 75%, 100%)
    └→ Label text
```

## API Service Layer

```
Components
    ↓
authService (services/auth.service.ts)
    ↓
api client (utils/api.ts)
    ↓
Axios with interceptors
    ├→ Request: Add headers
    └→ Response: Handle errors
    ↓
Backend API
```

## Error Handling Strategy

```
API Error
    ↓
Axios Interceptor
    ↓
Check Error Type
    ├→ Rate Limit (429)
    │   ├→ Extract retryAfter
    │   └→ Show RateLimitModal
    ├→ Validation Error (400)
    │   ├→ Extract field errors
    │   └→ Show inline messages
    ├→ Conflict (409)
    │   └→ Show error message
    └→ Server Error (500)
        └→ Show generic message
```

## Routing Architecture

```
/
├─ /register
│   ├─ User fills form
│   └─ Success → /verify-email?sent=true
│
├─ /verify-email
│   ├─ ?sent=true → Show "check email" message
│   └─ ?token={token}
│       ├─ Verify token
│       └─ Success → /login?verified=true
│
└─ /login (future)
    └─ ?verified=true → Show "email verified" message
```

## Styling System

```
Tailwind CSS Utilities
    ├→ Layout: flex, grid, spacing
    ├→ Colors: primary-{50-900}
    ├→ Typography: font, text-{size}
    ├→ States: hover:, focus:, disabled:
    └→ Responsive: sm:, md:, lg:
    
Component-Level Classes
    ├→ FormField: consistent spacing
    ├→ PasswordInput: icon positioning
    ├→ PasswordStrengthMeter: animated bar
    └→ RateLimitModal: centered overlay
```

## Accessibility Features

```
Semantic HTML
    ├→ <form> element
    ├→ <label> with htmlFor
    ├→ <input> with type
    └→ <button> for actions

ARIA Attributes
    ├→ aria-label on toggle buttons
    ├→ aria-invalid on error fields
    └→ role="alert" on error messages

Keyboard Navigation
    ├→ Tab order: natural flow
    ├→ Enter: submit form
    └→ Esc: close modal

Screen Readers
    ├→ Label associations
    ├→ Error announcements
    └→ State changes announced
```

## Testing Strategy

```
Unit Tests (Vitest + Testing Library)
    ├→ Component Rendering
    ├→ User Interactions
    ├→ Form Validation
    ├→ API Integration (mocked)
    └→ Error Handling

Integration Tests (Future)
    ├→ Complete user flows
    ├→ Route transitions
    └→ State persistence

E2E Tests (Future)
    ├→ Full registration flow
    ├→ Email verification flow
    └→ Error scenarios
```

## Performance Optimizations

```
Code Level
    ├→ useMemo for expensive calculations
    ├→ useCallback for event handlers
    ├→ React.memo for pure components
    └→ Debounced validation

Build Level
    ├→ Code splitting (routes)
    ├→ Tree shaking (Vite)
    ├→ Minification
    └→ Gzip compression

Runtime Level
    ├→ Lazy loading components
    ├→ Optimistic UI updates
    └→ Request caching
```

## Security Considerations

```
Client-Side
    ├→ Input sanitization
    ├→ XSS prevention (React escaping)
    ├→ CSRF token (axios interceptor)
    └→ HTTPS only (production)

Server Communication
    ├→ Encrypted passwords (HTTPS)
    ├→ No sensitive data in URLs
    ├→ Token-based verification
    └→ Rate limiting enforcement
```

## Deployment Checklist

- [ ] Environment variables configured
- [ ] API endpoints verified
- [ ] Build optimizations enabled
- [ ] Error tracking set up (Sentry)
- [ ] Analytics configured
- [ ] CDN configured for assets
- [ ] HTTPS certificate installed
- [ ] Security headers configured
- [ ] Performance monitoring enabled
- [ ] Accessibility audit passed

---

**Last Updated:** 2025-11-13
**Version:** 1.0.0
