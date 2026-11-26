// @vitest-environment jsdom
/**
 * Router pins. The page-level tests (e.g. ProvidersAdminPage.test.tsx)
 * exercise components in isolation and ASSUME the route wraps them in
 * AdminGuard — this file pins that the router actually does, so an RBAC
 * regression in router.tsx cannot pass silently.
 */
import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import { router } from '../router.js';
import { AdminGuard } from '../guards/AdminGuard.js';
import { TenantAdminGuard } from '../guards/TenantAdminGuard.js';

function flatten(routes: RouteObject[]): RouteObject[] {
  return routes.flatMap((r) => [r, ...(r.children != null ? flatten(r.children) : [])]);
}

describe('router — /admin/providers (Story 46-2)', () => {
  it('registers /admin/providers wrapped in AdminGuard', () => {
    const route = flatten(router.routes as RouteObject[]).find(
      (r) => r.path === '/admin/providers',
    );
    expect(route).toBeDefined();
    // The route element's OUTERMOST wrapper is the guard — platform-owner
    // RBAC applies before anything of the page (even its Suspense) renders.
    const element = route?.element as ReactElement;
    expect(element.type).toBe(AdminGuard);
  });
});

describe('router — /work tracker routes (Story 44-6)', () => {
  it('registers /work, /work/board, /work/:key and /work/projects under TenantAdminGuard', () => {
    const all = flatten(router.routes as RouteObject[]);
    expect(all.find((r) => r.path === '/work')).toBeDefined();
    expect(all.find((r) => r.path === '/work/board')).toBeDefined();
    expect(all.find((r) => r.path === '/work/:key')).toBeDefined();

    const projectsRoute = all.find((r) => r.path === '/work/projects');
    expect(projectsRoute).toBeDefined();
    expect((projectsRoute?.element as ReactElement).type).toBe(TenantAdminGuard);

    // D2: never register a /tasks route in packages/dashboard.
    expect(all.find((r) => r.path === '/tasks')).toBeUndefined();

    // Story 39-20: /admin/access wrapped in AdminGuard.
    const accessRoute = all.find((r) => r.path === '/admin/access');
    expect(accessRoute).toBeDefined();
    expect((accessRoute?.element as ReactElement).type).toBe(AdminGuard);
  });
});
