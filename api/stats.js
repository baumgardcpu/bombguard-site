import { createHash, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

// Owner-only visit/install stats for /stats.
// Auth: `Authorization: Bearer <STATS_ADMIN_SECRET>`. Reads aggregates through
// the get_app_event_stats() RPC with the Supabase service key, which only this
// function holds; anon can no longer SELECT app_events (migration 001).
// Same-origin only: no CORS headers, so other sites can't call it from a browser.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://mgalwgarvsjgalaqyeok.supabase.co";
const MIN_SECRET_LENGTH = 32;
const RATE_LIMIT = { max: 30, windowSec: 600 }; // per IP

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" && fwd.split(",")[0].trim()) || req.socket?.remoteAddress || "unknown";
}

// Fixed-window counter. Fails open if Redis is unavailable: the secret is the
// real gate, the limiter only slows guessing.
async function rateLimited(ip) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const key = `rl:stats:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_LIMIT.windowSec);
    return count > RATE_LIMIT.max;
  } catch (err) {
    console.error("stats rate limit error:", err);
    return false;
  }
}

// Hash both sides so timingSafeEqual gets equal-length buffers and the
// comparison time doesn't reveal the secret's length or prefix.
function secretMatches(given, expected) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function validTimeZone(tz) {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const count = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const text = (s) => (typeof s === "string" ? s.slice(0, 100) : null);

// Allowlist projection of the RPC result: counts and labels only.
function publicView(stats) {
  const t = stats?.totals ?? {};
  return {
    totals: {
      visits: count(t.visits),
      installs: count(t.installs),
      visitsToday: count(t.visits_today),
      installsToday: count(t.installs_today),
    },
    daily: (stats?.daily ?? []).map(({ day, visits, installs }) => ({
      day: text(day),
      visits: count(visits),
      installs: count(installs),
    })),
    platforms: (stats?.platforms ?? []).map(({ platform, visits, installs }) => ({
      platform: text(platform),
      visits: count(visits),
      installs: count(installs),
    })),
    locations: (stats?.locations ?? []).map(({ city, country, visits, installs }) => ({
      city: text(city),
      country: text(country),
      visits: count(visits),
      installs: count(installs),
    })),
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const adminSecret = process.env.STATS_ADMIN_SECRET || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (adminSecret.length < MIN_SECRET_LENGTH || !serviceKey) {
    console.error("stats: STATS_ADMIN_SECRET (>= 32 chars) and SUPABASE_SERVICE_ROLE_KEY must be set");
    return res.status(503).json({ error: "Stats not configured" });
  }

  if (await rateLimited(clientIp(req))) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !secretMatches(token, adminSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const tz = req.query?.tz ?? "UTC";
  if (!validTimeZone(tz)) return res.status(400).json({ error: "Invalid time zone" });

  try {
    const headers = { apikey: serviceKey, "Content-Type": "application/json" };
    // Legacy service_role keys are JWTs and go in Authorization too; the newer
    // sb_secret_ keys are sent as apikey only.
    if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;

    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_app_event_stats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_tz: tz }),
    });
    if (!upstream.ok) {
      console.error("stats upstream error:", upstream.status, await upstream.text());
      return res.status(502).json({ error: "Stats unavailable" });
    }
    return res.status(200).json(publicView(await upstream.json()));
  } catch (err) {
    console.error("stats handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
