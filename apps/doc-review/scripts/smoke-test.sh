#!/bin/bash

# Smoke Test Script for Tamma Doc Review
# This script runs basic smoke tests against a deployed application

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOYMENT_URL="${DEPLOYMENT_URL:-https://tamma-doc-review.pages.dev}"
TIMEOUT="${TIMEOUT:-30}"
VERBOSE="${VERBOSE:-false}"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Test assertion functions
assert_http_status() {
    local url="$1"
    local expected_status="$2"
    local test_name="${3:-HTTP Status Check}"

    ((TESTS_TOTAL++))

    if [[ "$VERBOSE" == "true" ]]; then
        log_info "Testing: $test_name"
        log_info "URL: $url"
    fi

    local response=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url")

    if [[ "$response" == "$expected_status" ]]; then
        log_success "$test_name (Status: $response)"
        ((TESTS_PASSED++))
        return 0
    else
        log_error "$test_name (Expected: $expected_status, Got: $response)"
        ((TESTS_FAILED++))
        return 1
    fi
}

assert_response_contains() {
    local url="$1"
    local expected_text="$2"
    local test_name="${3:-Response Content Check}"

    ((TESTS_TOTAL++))

    if [[ "$VERBOSE" == "true" ]]; then
        log_info "Testing: $test_name"
        log_info "URL: $url"
    fi

    local response=$(curl -s --max-time "$TIMEOUT" "$url")

    if echo "$response" | grep -q "$expected_text"; then
        log_success "$test_name"
        ((TESTS_PASSED++))
        return 0
    else
        log_error "$test_name (Expected text not found: '$expected_text')"
        if [[ "$VERBOSE" == "true" ]]; then
            echo "Response preview:"
            echo "$response" | head -n 10
        fi
        ((TESTS_FAILED++))
        return 1
    fi
}

assert_json_field() {
    local url="$1"
    local json_path="$2"
    local expected_value="$3"
    local test_name="${4:-JSON Field Check}"

    ((TESTS_TOTAL++))

    if [[ "$VERBOSE" == "true" ]]; then
        log_info "Testing: $test_name"
        log_info "URL: $url"
    fi

    if ! command -v jq &> /dev/null; then
        log_warning "$test_name (jq not installed, skipping)"
        return 0
    fi

    local response=$(curl -s --max-time "$TIMEOUT" "$url")
    local actual_value=$(echo "$response" | jq -r "$json_path")

    if [[ "$actual_value" == "$expected_value" ]]; then
        log_success "$test_name (Value: $actual_value)"
        ((TESTS_PASSED++))
        return 0
    else
        log_error "$test_name (Expected: $expected_value, Got: $actual_value)"
        ((TESTS_FAILED++))
        return 1
    fi
}

assert_response_time() {
    local url="$1"
    local max_time="$2"
    local test_name="${3:-Response Time Check}"

    ((TESTS_TOTAL++))

    if [[ "$VERBOSE" == "true" ]]; then
        log_info "Testing: $test_name"
        log_info "URL: $url"
    fi

    local response_time=$(curl -s -o /dev/null -w "%{time_total}" --max-time "$TIMEOUT" "$url")
    # Convert to milliseconds for easier reading
    local response_time_ms=$(echo "$response_time * 1000" | bc)

    if (( $(echo "$response_time < $max_time" | bc -l) )); then
        log_success "$test_name (${response_time_ms}ms < ${max_time}s)"
        ((TESTS_PASSED++))
        return 0
    else
        log_error "$test_name (${response_time_ms}ms >= ${max_time}s)"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Print test header
print_header() {
    echo ""
    echo "=========================================="
    echo "  Tamma Doc Review - Smoke Tests"
    echo "=========================================="
    echo "Target: $DEPLOYMENT_URL"
    echo "Timeout: ${TIMEOUT}s"
    echo "=========================================="
    echo ""
}

# Print test summary
print_summary() {
    echo ""
    echo "=========================================="
    echo "  Test Results Summary"
    echo "=========================================="
    echo "Total Tests:  $TESTS_TOTAL"
    echo -e "Passed:       ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Failed:       ${RED}$TESTS_FAILED${NC}"

    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "Status:       ${GREEN}ALL TESTS PASSED${NC}"
    else
        echo -e "Status:       ${RED}SOME TESTS FAILED${NC}"
    fi
    echo "=========================================="
    echo ""
}

# Test: Health Check Endpoint
test_health_check() {
    log_info "Running health check tests..."

    assert_http_status \
        "$DEPLOYMENT_URL/health" \
        "200" \
        "Health endpoint returns 200 OK"

    assert_json_field \
        "$DEPLOYMENT_URL/health" \
        ".status" \
        "healthy" \
        "Health status is 'healthy'"

    assert_json_field \
        "$DEPLOYMENT_URL/health" \
        ".checks.database.status" \
        "healthy" \
        "Database health check is healthy"

    assert_json_field \
        "$DEPLOYMENT_URL/health" \
        ".checks.kv.status" \
        "healthy" \
        "KV health check is healthy"

    assert_response_time \
        "$DEPLOYMENT_URL/health" \
        "1.0" \
        "Health endpoint responds within 1 second"
}

# Test: Homepage
test_homepage() {
    log_info "Running homepage tests..."

    assert_http_status \
        "$DEPLOYMENT_URL/" \
        "200" \
        "Homepage returns 200 OK"

    assert_response_contains \
        "$DEPLOYMENT_URL/" \
        "Tamma" \
        "Homepage contains application name"

    assert_response_time \
        "$DEPLOYMENT_URL/" \
        "2.0" \
        "Homepage responds within 2 seconds"
}

# Test: Static Assets
test_static_assets() {
    log_info "Running static asset tests..."

    # Note: Adjust these paths based on your actual build output
    # These are examples - update with actual asset paths after build

    # Test that static assets directory is accessible
    # This is a basic check - in production you'd test actual asset files
}

# Test: API Endpoints
test_api_endpoints() {
    log_info "Running API endpoint tests..."

    # Test: Sessions endpoint (should require auth)
    # This should return 401 or redirect when not authenticated
    assert_http_status \
        "$DEPLOYMENT_URL/api/sessions" \
        "401" \
        "Sessions API requires authentication"
}

# Test: Authentication Flows
test_authentication() {
    log_info "Running authentication tests..."

    # Test: Login page is accessible
    assert_http_status \
        "$DEPLOYMENT_URL/auth/login" \
        "200" \
        "Login page is accessible"

    # We can't test full OAuth flow without credentials
    # but we can check that the endpoints exist
}

# Test: Error Handling
test_error_handling() {
    log_info "Running error handling tests..."

    # Test: 404 page
    assert_http_status \
        "$DEPLOYMENT_URL/this-page-does-not-exist-$(date +%s)" \
        "404" \
        "404 page returns correct status"
}

# Test: Security Headers
test_security_headers() {
    log_info "Running security header tests..."

    local headers=$(curl -s -I --max-time "$TIMEOUT" "$DEPLOYMENT_URL/")

    ((TESTS_TOTAL++))
    if echo "$headers" | grep -qi "x-content-type-options"; then
        log_success "X-Content-Type-Options header is set"
        ((TESTS_PASSED++))
    else
        log_warning "X-Content-Type-Options header is missing"
        # Don't fail on missing headers, just warn
    fi

    ((TESTS_TOTAL++))
    if echo "$headers" | grep -qi "x-frame-options"; then
        log_success "X-Frame-Options header is set"
        ((TESTS_PASSED++))
    else
        log_warning "X-Frame-Options header is missing"
    fi
}

# Test: Database Connectivity
test_database_connectivity() {
    log_info "Running database connectivity tests..."

    # Database connectivity is tested via health check
    # This is redundant but shows explicit test
    assert_json_field \
        "$DEPLOYMENT_URL/health" \
        ".checks.database.status" \
        "healthy" \
        "Database is accessible via health check"
}

# Test: Performance
test_performance() {
    log_info "Running performance tests..."

    # Test multiple endpoints for response time
    assert_response_time \
        "$DEPLOYMENT_URL/" \
        "3.0" \
        "Homepage performance (< 3s)"

    assert_response_time \
        "$DEPLOYMENT_URL/health" \
        "1.0" \
        "Health endpoint performance (< 1s)"
}

# Main test execution
main() {
    print_header

    # Check if deployment URL is accessible
    log_info "Checking if deployment is accessible..."
    if ! curl -sf --max-time "$TIMEOUT" "$DEPLOYMENT_URL/health" > /dev/null 2>&1; then
        log_error "Deployment is not accessible at $DEPLOYMENT_URL"
        log_error "Please check if the deployment is complete and the URL is correct"
        exit 1
    fi
    log_success "Deployment is accessible"
    echo ""

    # Run test suites
    test_health_check
    echo ""

    test_homepage
    echo ""

    test_static_assets
    echo ""

    test_api_endpoints
    echo ""

    test_authentication
    echo ""

    test_error_handling
    echo ""

    test_security_headers
    echo ""

    test_database_connectivity
    echo ""

    test_performance
    echo ""

    # Print summary
    print_summary

    # Exit with appropriate code
    if [[ $TESTS_FAILED -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --url)
            DEPLOYMENT_URL="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --url URL        Deployment URL (default: https://tamma-doc-review.pages.dev)"
            echo "  --timeout SEC    Request timeout in seconds (default: 30)"
            echo "  --verbose        Enable verbose output"
            echo "  --help           Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  DEPLOYMENT_URL   Same as --url"
            echo "  TIMEOUT          Same as --timeout"
            echo "  VERBOSE          Same as --verbose (set to 'true')"
            echo ""
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run main function
main "$@"
