// packages/sdk/src/index.ts
class TakuSitesRequestError extends Error {
  status;
  code;
  retryAfter;
  constructor(status, code, retryAfter) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.name = "TakuSitesRequestError";
  }
}
var CAPABILITY_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
var SCOPE_NAME = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeBaseUrl(value) {
  try {
    const fallback = typeof globalThis.location === "object" ? globalThis.location.origin : "";
    const url = new URL(value ?? fallback);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || url.protocol === "http:" && loopback) && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}
function retryAfter(value) {
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}
function createTakuSitesClient(options = {}) {
  const fetcher = options.fetcher ?? ((request2) => fetch(request2));
  const baseUrl = safeBaseUrl(options.baseUrl);
  const navigate = options.navigate ?? ((url) => {
    if (typeof globalThis.location !== "object")
      throw new Error("auth_unavailable");
    globalThis.location.assign(url);
  });
  async function request(path, init = {}) {
    if (!baseUrl)
      throw new Error("site_origin_unavailable");
    const url = new URL(path, baseUrl);
    if (url.origin !== baseUrl || !url.pathname.startsWith("/__taku/")) {
      throw new Error("invalid_platform_path");
    }
    const headers = new Headers(init.headers);
    if (init.method && init.method !== "GET")
      headers.set("X-Taku-CSRF", "1");
    if (init.body)
      headers.set("Content-Type", "application/json");
    const response = await fetcher(new Request(url, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error"
    })).catch(() => {
      throw new TakuSitesRequestError(503, "platform_unavailable");
    });
    if (!response.ok) {
      let code = "request_failed";
      try {
        const body = await response.clone().json();
        if (isRecord(body) && typeof body.error === "string")
          code = body.error;
      } catch {}
      throw new TakuSitesRequestError(response.status, code, retryAfter(response.headers.get("Retry-After")));
    }
    if (response.status === 204)
      return null;
    return response.json();
  }
  function capabilityName(value) {
    if (!CAPABILITY_NAME.test(value))
      throw new Error("invalid_capability_name");
    return value;
  }
  return {
    auth: {
      async getSession() {
        const value = await request("/__taku/session");
        if (isRecord(value) && value.authenticated === false) {
          return {
            authenticated: false,
            ...value.mode === "preview" ? { mode: "preview" } : {}
          };
        }
        if (isRecord(value) && value.authenticated === true && typeof value.siteUserId === "string" && Array.isArray(value.scopes) && value.scopes.every((scope) => typeof scope === "string")) {
          return {
            authenticated: true,
            siteUserId: value.siteUserId,
            scopes: value.scopes,
            ...value.mode === "preview" ? { mode: "preview" } : {}
          };
        }
        throw new Error("invalid_platform_response");
      },
      async signIn(input) {
        if (!Array.isArray(input.scopes) || input.scopes.length > 32 || new Set(input.scopes).size !== input.scopes.length || !input.scopes.every((scope) => SCOPE_NAME.test(scope))) {
          throw new Error("invalid_scope");
        }
        const returnTo = input.returnTo ?? "/";
        if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
          throw new Error("invalid_return_path");
        }
        const value = await request("/__taku/auth/start", {
          method: "POST",
          body: JSON.stringify({ scopes: input.scopes, returnPath: returnTo })
        });
        if (isRecord(value) && value.mode === "preview" && value.opened === true) {
          const deadline = Date.now() + 30 * 60 * 1000;
          while (Date.now() < deadline) {
            const session = await request("/__taku/session");
            const granted = isRecord(session) && Array.isArray(session.scopes) ? session.scopes : [];
            if (isRecord(session) && session.mode === "preview" && session.authenticated === true && typeof session.siteUserId === "string" && input.scopes.every((scope) => granted.includes(scope)))
              return;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          throw new TakuSitesRequestError(408, "preview_auth_timeout");
        }
        if (!isRecord(value) || typeof value.authorizeUrl !== "string") {
          throw new Error("auth_unavailable");
        }
        const destination = new URL(value.authorizeUrl);
        if (destination.origin !== "https://taku.ai" || destination.pathname !== "/auth/sites") {
          throw new Error("auth_unavailable");
        }
        navigate(destination.toString());
      },
      async signOut() {
        await request("/__taku/auth/logout", { method: "POST" });
      }
    },
    integration: {
      async call(name, operation, input, options2 = {}) {
        const integration = capabilityName(name);
        const action = capabilityName(operation);
        const requestId = options2.requestId ?? crypto.randomUUID();
        if (!/^[A-Za-z0-9._:~-]{16,128}$/.test(requestId))
          throw new Error("invalid_request_id");
        return request(`/__taku/integrations/${integration}/${action}`, {
          method: "POST",
          headers: { "Idempotency-Key": requestId },
          body: JSON.stringify(input)
        });
      }
    },
    storage: {
      favorites: {
        async list() {
          const value = await request("/__taku/storage/favorites");
          if (!isRecord(value) || !Array.isArray(value.favorites))
            throw new Error("invalid_platform_response");
          return value.favorites;
        },
        async save(favorite) {
          await request("/__taku/storage/favorites", {
            method: "POST",
            body: JSON.stringify(favorite)
          });
        },
        async delete(listingId) {
          if (!/^[1-9][0-9]{2,31}$/.test(listingId))
            throw new Error("invalid_listing_id");
          await request("/__taku/storage/favorites/" + listingId, {
            method: "DELETE"
          });
        }
      },
      query(statement, params = []) {
        if (!statement.trim() || statement.length > 16384 || params.length > 128) {
          return Promise.reject(new Error("invalid_storage_query"));
        }
        return request("/__taku/storage/query", {
          method: "POST",
          body: JSON.stringify({ statement, params })
        });
      },
      batch(statements) {
        if (!Array.isArray(statements) || statements.length < 1 || statements.length > 20) {
          return Promise.reject(new Error("invalid_storage_batch"));
        }
        return request("/__taku/storage/batch", {
          method: "POST",
          body: JSON.stringify({ statements })
        });
      }
    },
    usage: {
      getSummary() {
        return request("/__taku/usage");
      }
    }
  };
}
var taku = createTakuSitesClient();
export {
  taku,
  createTakuSitesClient,
  TakuSitesRequestError
};
