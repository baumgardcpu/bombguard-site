import { Redis } from "@upstash/redis";

// Public arcade leaderboard for Boston Tea Party.
// CORS is intentionally open: this is an unauthenticated, credential-less
// endpoint also called from the packaged Android (Capacitor) build, whose
// origin is not a fixed web origin. No cookies/auth ride on these requests.

// Connects to whatever Redis/KV store is bound to the project. Vercel's
// Marketplace integrations inject env vars under either KV_* or UPSTASH_*
// names depending on how the store was added, so accept both.
function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Never expose the PIN — it is a write-only secret used only to protect a name
// from being overwritten by someone else. Strip it from everything we return.
function publicView(scores, limit) {
  return scores.slice(0, limit).map(({ name, score, level, date }) => ({
    name,
    score,
    level,
    date,
  }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({ error: "Leaderboard storage not configured" });
  }

  try {
    if (req.method === "GET") {
      const scores = (await redis.get("btp_leaderboard")) || [];
      return res.status(200).json(publicView(scores, 10));
    }

    if (req.method === "POST") {
      const { name, pin, score, level } = req.body ?? {};

      // Validate and normalize input server-side — never trust the client.
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Missing or invalid name" });
      }
      const numScore = Number(score);
      if (!Number.isFinite(numScore) || numScore < 0) {
        return res.status(400).json({ error: "Missing or invalid score" });
      }

      const cleanName = name.slice(0, 3).toUpperCase();
      const cleanPin = String(pin ?? "0000").replace(/\D/g, "").slice(0, 4).padStart(4, "0");
      const numLevel = Number.isFinite(Number(level)) ? Number(level) : 1;

      let scores = (await redis.get("btp_leaderboard")) || [];

      // PIN-protect a name: if this name already exists on the board, the
      // submitter must present the same PIN it was first registered with.
      // This stops anyone from posting scores under someone else's name.
      const owner = scores.find((s) => s.name === cleanName);
      if (owner && owner.pin && owner.pin !== cleanPin) {
        return res.status(403).json({ error: "This name is protected by a different PIN" });
      }

      scores.push({
        name: cleanName,
        pin: cleanPin,
        score: numScore,
        level: numLevel,
        date: new Date().toISOString(),
      });
      scores.sort((a, b) => b.score - a.score);
      scores = scores.slice(0, 100); // store top 100, serve top 10
      await redis.set("btp_leaderboard", scores);
      return res.status(200).json(publicView(scores, 10));
    }

    res.status(405).end();
  } catch (err) {
    console.error("scores handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
