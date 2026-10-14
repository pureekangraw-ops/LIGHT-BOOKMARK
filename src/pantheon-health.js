// PANTHEON WorkHub connection through an internal Worker Service Binding.
// Keep the bookmark database and Notion pointers independent from WorkHub.
const HEALTH_URL = "https://phatheon-workhub.internal/health";

export async function pantheonHealth(env) {
  if (!env?.PANTHEON || typeof env.PANTHEON.fetch !== "function") {
    return { connected: false, status: "NOT_CONFIGURED", scope: "health-only" };
  }

  let response;
  try {
    response = await env.PANTHEON.fetch(new Request(HEALTH_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    }));
  } catch {
    return { connected: false, status: "UPSTREAM_UNAVAILABLE", scope: "health-only" };
  }

  if (!response?.ok) {
    return {
      connected: false,
      status: "UPSTREAM_HTTP_ERROR",
      http_status: Number.isInteger(response?.status) ? response.status : null,
      scope: "health-only",
    };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { connected: false, status: "INVALID_UPSTREAM_RESPONSE", scope: "health-only" };
  }

  // Never forward task lists, factory data, secrets or unverified upstream fields.
  if (!data || data.ok !== true || data.service !== "pantheon-workhub") {
    return { connected: false, status: "INVALID_UPSTREAM_RESPONSE", scope: "health-only" };
  }
  return {
    connected: true,
    status: "CONNECTED",
    upstream_service: "pantheon-workhub",
    transport: "cloudflare-service-binding",
    scope: "health-only",
  };
}
