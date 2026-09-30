// packages/sdk/src/index.ts
var SITE_CAPABILITY_INTERNAL_ONLY = "SITE_CAPABILITY_INTERNAL_ONLY";

class TakuSitesRequestError extends Error {
  status;
  code;
  retryAfter;
  requestId;
  constructor(status, code, retryAfter, requestId) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
    this.name = "TakuSitesRequestError";
  }
  get internalOnly() {
    return this.code === SITE_CAPABILITY_INTERNAL_ONLY;
  }
}
var CAPABILITY_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
var RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var SCOPE_NAME = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
var MEDIA_JOB_ID = /^(?:med|mgn)_[0-9a-f]{32}$/;
var MEDIA_GENERATION_JOB_ID = /^mgn_[0-9a-f]{32}$/;
var MEDIA_VIDEO_MAX_BYTES = 40 * 1024 * 1024;
var MEDIA_VIDEO_CONTENT_TYPES = ["video/mp4", "video/webm"];
var IMAGE_ASPECT_RATIOS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"];
var VIDEO_ASPECT_RATIOS = ["16:9", "9:16"];
var MEDIA_INPUT_ID = /^min_[0-9a-f]{32}$/;
var MEDIA_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
var MEDIA_MAX_BYTES = 20 * 1024 * 1024;
var MEDIA_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
var MEDIA_PERMIT_TOKEN = /^[A-Za-z0-9_-]{1,900}\.[0-9a-f]{64}$/;
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
async function boundedResponseJson(response, limit) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error("invalid_platform_response");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done)
        break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("invalid_platform_response");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    reader.releaseLock();
  }
}
function createTakuSitesClient(options = {}) {
  const fetcher = options.fetcher ?? ((request2) => fetch(request2));
  const baseUrl = safeBaseUrl(options.baseUrl);
  const navigate = options.navigate ?? ((url) => {
    if (typeof globalThis.location !== "object")
      throw new Error("auth_unavailable");
    globalThis.location.assign(url);
  });
  async function request(path, init = {}, maxBytes) {
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
        const body = maxBytes ? await boundedResponseJson(response, maxBytes) : await response.clone().json();
        if (isRecord(body) && typeof body.error === "string")
          code = body.error;
      } catch {}
      throw new TakuSitesRequestError(response.status, code, retryAfter(response.headers.get("Retry-After")), /^[A-Za-z0-9_.:-]{1,128}$/.test(response.headers.get("X-Request-Id") ?? "") ? response.headers.get("X-Request-Id") : undefined);
    }
    if (response.status === 204)
      return null;
    return maxBytes ? boundedResponseJson(response, maxBytes) : response.json();
  }
  function startedJob(value, jobId) {
    if (!isRecord(value) || value.schema_version !== "taku.site-media-job.v1" || typeof value.job_id !== "string" || !jobId.test(value.job_id) || typeof value.status !== "string" || typeof value.terminal !== "boolean" || value.asset_content !== undefined || value.expires_at !== undefined || Object.keys(value).some((key) => ![
      "schema_version",
      "job_id",
      "status",
      "terminal",
      "poll_after_ms"
    ].includes(key)) || value.poll_after_ms !== undefined && (!Number.isSafeInteger(value.poll_after_ms) || value.poll_after_ms < 1000 || value.poll_after_ms > 30000))
      throw new Error("invalid_platform_response");
    return value;
  }
  async function generate(kind, prompt, options2) {
    if (typeof prompt !== "string" || !prompt.trim() || [...prompt.trim()].length > 4000)
      throw new Error("invalid_media_prompt");
    const requestId = options2.requestId ?? crypto.randomUUID();
    if (!MEDIA_REQUEST_ID.test(requestId))
      throw new Error("invalid_request_id");
    if (options2.aspectRatio !== undefined && !(kind === "videos" ? VIDEO_ASPECT_RATIOS : IMAGE_ASPECT_RATIOS).includes(options2.aspectRatio))
      throw new Error("invalid_media_aspect_ratio");
    if (options2.durationSeconds !== undefined && (kind !== "videos" || ![4, 6, 8].includes(options2.durationSeconds)))
      throw new Error("invalid_media_duration");
    const value = await request(`/__taku/media/generations/${kind}`, {
      method: "POST",
      headers: { "Idempotency-Key": requestId },
      body: JSON.stringify({
        prompt: prompt.trim(),
        ...options2.aspectRatio === undefined ? {} : { aspect_ratio: options2.aspectRatio },
        ...options2.durationSeconds === undefined ? {} : { duration_seconds: options2.durationSeconds }
      })
    });
    return startedJob(value, MEDIA_GENERATION_JOB_ID);
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
    media: {
      async createInput(contentType, options2 = {}) {
        if (!MEDIA_CONTENT_TYPES.includes(contentType))
          throw new Error("invalid_media_input");
        const requestId = options2.requestId ?? crypto.randomUUID();
        if (!MEDIA_REQUEST_ID.test(requestId))
          throw new Error("invalid_request_id");
        const value = await request("/__taku/media/inputs/permit", {
          method: "POST",
          headers: { "Idempotency-Key": requestId },
          body: JSON.stringify({ content_type: contentType })
        });
        if (!isRecord(value) || Object.keys(value).length !== 5 || typeof value.input_id !== "string" || !MEDIA_INPUT_ID.test(value.input_id) || value.content_type !== contentType || value.upload_path !== `/__taku/media/inputs/${value.input_id}/content` || typeof value.upload_token !== "string" || !MEDIA_PERMIT_TOKEN.test(value.upload_token) || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at)))
          throw new Error("invalid_platform_response");
        return value;
      },
      async uploadInput(permit, image) {
        if (!baseUrl)
          throw new Error("site_origin_unavailable");
        if (!permit || !MEDIA_INPUT_ID.test(permit.input_id) || !MEDIA_CONTENT_TYPES.includes(permit.content_type) || permit.upload_path !== `/__taku/media/inputs/${permit.input_id}/content` || !MEDIA_PERMIT_TOKEN.test(permit.upload_token) || !Number.isFinite(Date.parse(permit.expires_at)))
          throw new Error("invalid_media_permit");
        if (Date.parse(permit.expires_at) <= Date.now())
          throw new Error("media_upload_permit_expired");
        if (!(image instanceof Blob) || image.type !== permit.content_type || image.size < 1 || image.size > MEDIA_MAX_BYTES)
          throw new Error("invalid_media_input");
        const response = await fetcher(new Request(new URL(permit.upload_path, baseUrl), {
          method: "PUT",
          headers: {
            "Content-Type": image.type,
            "X-Taku-CSRF": "1",
            "X-Taku-Media-Upload-Permit": permit.upload_token
          },
          body: image,
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
        const value = await response.json();
        if (!isRecord(value) || Object.keys(value).length !== 2 || value.input_id !== permit.input_id || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at)))
          throw new Error("invalid_platform_response");
        return value;
      },
      async editImage(inputId, prompt, options2 = {}) {
        if (!MEDIA_INPUT_ID.test(inputId))
          throw new Error("invalid_media_input_id");
        if (typeof prompt !== "string" || !prompt.trim() || [...prompt.trim()].length > 4000)
          throw new Error("invalid_media_prompt");
        const requestId = options2.requestId ?? crypto.randomUUID();
        if (!MEDIA_REQUEST_ID.test(requestId))
          throw new Error("invalid_request_id");
        if (options2.aspectRatio !== undefined && !["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"].includes(options2.aspectRatio))
          throw new Error("invalid_media_aspect_ratio");
        const value = await request("/__taku/media/edits", {
          method: "POST",
          headers: { "Idempotency-Key": requestId },
          body: JSON.stringify({
            prompt: prompt.trim(),
            input_ids: [inputId],
            ...options2.aspectRatio === undefined ? {} : { aspect_ratio: options2.aspectRatio },
            ...options2.resolution === undefined ? {} : { resolution: options2.resolution },
            ...options2.outputFormat === undefined ? {} : { output_format: options2.outputFormat }
          })
        });
        return startedJob(value, /^med_[0-9a-f]{32}$/);
      },
      async generateImage(prompt, options2 = {}) {
        return generate("images", prompt, options2);
      },
      async generateVideo(prompt, options2 = {}) {
        return generate("videos", prompt, options2);
      },
      async getJob(jobId) {
        if (!MEDIA_JOB_ID.test(jobId))
          throw new Error("invalid_media_job_id");
        const value = await request(`/__taku/media/jobs/${jobId}`, {
          method: "GET",
          headers: { "X-Taku-CSRF": "1" }
        });
        if (!isRecord(value) || value.schema_version !== "taku.site-media-job.v1" || value.job_id !== jobId || typeof value.status !== "string" || typeof value.terminal !== "boolean" || Object.keys(value).some((key) => ![
          "schema_version",
          "job_id",
          "status",
          "terminal",
          "poll_after_ms",
          "asset_content",
          "expires_at"
        ].includes(key)) || value.poll_after_ms !== undefined && (!Number.isSafeInteger(value.poll_after_ms) || value.poll_after_ms < 1000 || value.poll_after_ms > 30000) || value.asset_content !== undefined && (value.status !== "completed" || value.terminal !== true || value.asset_content !== `/__taku/media/jobs/${jobId}/assets/0/content` || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at))) || value.expires_at !== undefined && (typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at)))) {
          throw new Error("invalid_platform_response");
        }
        return value;
      },
      async getAssetLink(jobId) {
        if (!MEDIA_JOB_ID.test(jobId))
          throw new Error("invalid_media_job_id");
        const value = await request(`/__taku/media/jobs/${jobId}/asset-link`, {
          method: "GET",
          headers: { "X-Taku-CSRF": "1" }
        }, 16 * 1024);
        if (!isRecord(value) || value.schema_version !== "taku.media-asset-link.v1")
          throw new Error("invalid_platform_response");
        if ((value.state === "pending" || value.state === "copying") && Object.keys(value).length === 2)
          throw new TakuSitesRequestError(409, "media_asset_not_ready", 5);
        if (value.state === "failed" && Object.keys(value).length === 4 && typeof value.error_code === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(value.error_code) && typeof value.retryable === "boolean")
          throw new TakuSitesRequestError(value.retryable ? 503 : 422, value.error_code, value.retryable ? 5 : undefined);
        const fields = ["schema_version", "state", "url", "expires_at", "asset_expires_at", "content_type", "byte_length"];
        if (value.state !== "ready" || Object.keys(value).length !== fields.length || !fields.every((key) => Object.hasOwn(value, key)) || typeof value.url !== "string" || value.url.length > 2048 || typeof value.expires_at !== "string" || typeof value.asset_expires_at !== "string" || typeof value.content_type !== "string" || typeof value.byte_length !== "number" || !Number.isSafeInteger(value.byte_length) || value.byte_length < 1)
          throw new Error("invalid_platform_response");
        let url;
        try {
          url = new URL(value.url);
        } catch {
          throw new Error("invalid_platform_response");
        }
        const video = value.content_type.startsWith("video/"), generated = MEDIA_GENERATION_JOB_ID.test(jobId);
        const types = generated && video ? MEDIA_VIDEO_CONTENT_TYPES : MEDIA_CONTENT_TYPES;
        const maxBytes = generated ? (video ? 100 : 25) * 1024 * 1024 : 64 * 1024 * 1024;
        const expires = Date.parse(value.expires_at), assetExpires = Date.parse(value.asset_expires_at), now = Date.now();
        if (url.protocol !== "https:" || url.username || url.password || url.hash || !/^\/media\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/content$/i.test(url.pathname) || [...url.searchParams.keys()].length !== 1 || !url.searchParams.get("ticket") || !types.includes(value.content_type) || value.byte_length > maxBytes || !Number.isFinite(expires) || !Number.isFinite(assetExpires) || expires <= now || expires > now + 330000 || assetExpires < expires)
          throw new Error("invalid_platform_response");
        return { url: url.href, urlExpiresAt: value.expires_at, assetExpiresAt: value.asset_expires_at, contentType: value.content_type, byteLength: value.byte_length };
      },
      async getAsset(jobId) {
        if (!MEDIA_JOB_ID.test(jobId))
          throw new Error("invalid_media_job_id");
        if (!baseUrl)
          throw new Error("site_origin_unavailable");
        const url = new URL(`/__taku/media/jobs/${jobId}/assets/0/content`, baseUrl);
        const response = await fetcher(new Request(url, {
          method: "GET",
          headers: { "X-Taku-CSRF": "1" },
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
        const type = response.headers.get("Content-Type")?.trim() ?? "";
        const length = response.headers.get("Content-Length") ?? "";
        const declared = Number(length);
        const generated = MEDIA_GENERATION_JOB_ID.test(jobId);
        const types = generated ? [...MEDIA_CONTENT_TYPES, ...MEDIA_VIDEO_CONTENT_TYPES] : MEDIA_CONTENT_TYPES;
        if (!types.includes(type) || !/^[1-9][0-9]*$/.test(length) || !Number.isSafeInteger(declared) || declared > (generated ? MEDIA_VIDEO_MAX_BYTES : MEDIA_MAX_BYTES) || !response.body) {
          await response.body?.cancel();
          throw new Error("invalid_platform_response");
        }
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done)
              break;
            received += next.value.byteLength;
            if (received > declared) {
              await reader.cancel();
              throw new Error("invalid_platform_response");
            }
            const copy = new Uint8Array(next.value.byteLength);
            copy.set(next.value);
            chunks.push(copy.buffer);
          }
          if (received !== declared)
            throw new Error("invalid_platform_response");
          return new Blob(chunks, { type });
        } catch (error) {
          if (error instanceof Error && error.message === "invalid_platform_response")
            throw error;
          throw new TakuSitesRequestError(503, "platform_unavailable");
        } finally {
          reader.releaseLock();
        }
      }
    },
    storage: {
      submissions: {
        async create(input, options2 = {}) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3 || typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100 || typeof input.email !== "string" || input.email.trim().length < 3 || input.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || typeof input.message !== "string" || !input.message.trim() || input.message.trim().length > 4000) {
            throw new Error("invalid_submission");
          }
          const requestId = options2.requestId ?? crypto.randomUUID();
          if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId))
            throw new Error("invalid_request_id");
          const body = JSON.stringify({ name: input.name.trim(), email: input.email.trim(), message: input.message.trim() });
          if (new TextEncoder().encode(body).byteLength > 8 * 1024)
            throw new Error("submission_too_large");
          const value = await request("/__taku/storage/submissions", {
            method: "POST",
            headers: { "Idempotency-Key": requestId },
            body
          });
          if (!isRecord(value) || typeof value.receiptId !== "string" || typeof value.receivedAt !== "string")
            throw new Error("invalid_platform_response");
          return { receiptId: value.receiptId, receivedAt: value.receivedAt };
        }
      },
      personal: {
        async list(collection) {
          const name = capabilityName(collection);
          const value = await request(`/__taku/storage/personal/${name}`);
          if (!isRecord(value) || !Array.isArray(value.records) || !value.records.every((entry) => isRecord(entry) && typeof entry.key === "string" && Object.hasOwn(entry, "value"))) {
            throw new Error("invalid_platform_response");
          }
          return value.records;
        },
        async put(collection, key, value) {
          const name = capabilityName(collection);
          if (!RECORD_KEY.test(key))
            throw new Error("invalid_record_key");
          const body = JSON.stringify(value);
          if (body === undefined || new TextEncoder().encode(body).byteLength > 8 * 1024)
            throw new Error("record_too_large");
          await request(`/__taku/storage/personal/${name}/${key}`, { method: "PUT", body });
        },
        async delete(collection, key) {
          const name = capabilityName(collection);
          if (!RECORD_KEY.test(key))
            throw new Error("invalid_record_key");
          await request(`/__taku/storage/personal/${name}/${key}`, { method: "DELETE" });
        }
      },
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
            body: JSON.stringify({
              listingId: favorite.listingId,
              title: favorite.title,
              imageUrl: favorite.imageUrl,
              priceText: favorite.priceText,
              location: favorite.location,
              deepLink: favorite.deepLink
            })
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
  TakuSitesRequestError,
  SITE_CAPABILITY_INTERNAL_ONLY
};
