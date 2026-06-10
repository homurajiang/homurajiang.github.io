export default {
  async fetch(request, env, ctx) {
    // 允许的来源（浏览器 CORS 校验用）
    const ALLOWED_ORIGINS = new Set([
      "https://homurajiang.github.io",
      "http://localhost",
      "http://localhost:8080",
      "http://localhost:5500",
      "http://127.0.0.1",
      "http://127.0.0.1:8080",
      "http://127.0.0.1:5500",
    ]);

    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://homurajiang.github.io";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    // API Key 校验
    const requestApiKey = request.headers.get("x-api-key");
    if (requestApiKey !== env.API_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const storageKey = decodeURIComponent(url.pathname.slice(1));
    if (!storageKey) {
      return new Response(JSON.stringify({ error: "Key is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Key 白名单：
    //   - 羽毛球分享数据： bad_match/<id>，id 为 6~32 位 [a-z0-9]
    //   - 羽毛球分组记录： badminton_tournament/<id>，id 为 6~32 位 [a-z0-9]
    //   - 老的测试 key： test-data （保留兼容）
    const isBadMatch = /^bad_match\/[a-z0-9]{6,32}$/.test(storageKey);
    const isTournament = /^badminton_tournament\/[a-z0-9]{6,32}$/.test(storageKey);
    const isLegacyTest = storageKey === "test-data";
    if (!isBadMatch && !isTournament && !isLegacyTest) {
      return new Response(JSON.stringify({ error: "Invalid key format" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    try {
      switch (request.method) {
        case "GET": {
          const value = await env.STORAGE.get(storageKey);
          return new Response(value || "null", { headers: corsHeaders });
        }
        case "PUT": {
          const content = await request.text();
          // 单条记录最大 100KB，防止被写爆
          if (content.length > 100 * 1024) {
            return new Response(JSON.stringify({ error: "Payload too large" }), {
              status: 413,
              headers: corsHeaders,
            });
          }
          await env.STORAGE.put(storageKey, content);
          return new Response(JSON.stringify({ success: true, message: "Data saved" }), {
            headers: corsHeaders,
          });
        }
        case "DELETE": {
          await env.STORAGE.delete(storageKey);
          return new Response(JSON.stringify({ success: true, message: "Data deleted" }), {
            headers: corsHeaders,
          });
        }
        default:
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: corsHeaders,
          });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: "Server internal error", detail: error.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
