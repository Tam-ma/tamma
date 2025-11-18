import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
  route("search", "routes/search.tsx"),
  route("test-env", "routes/test-env.tsx"),
  route("test-doc", "routes/test-doc.tsx"),
  route("api/comments", "routes/api.comments.tsx"),
  route("api/suggestions", "routes/api.suggestions.tsx"),
  route("api/discussions", "routes/api.discussions.tsx"),
  route("api/sessions", "routes/api.sessions.tsx"),
  route("docs", "routes/docs.tsx", [
    index("routes/docs._index.tsx"),
    route(":documentId", "routes/docs.$documentId.tsx"),
  ]),
] satisfies RouteConfig;
