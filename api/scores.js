import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const scores = (await kv.get("btp_leaderboard")) || [];
    return res.status(200).json(scores.slice(0, 10));
  }

  if (req.method === "POST") {
    const { name, pin, score, level } = req.body;
    if (!name || score === undefined) {
      return res.status(400).json({ error: "Missing name or score" });
    }

    let scores = (await kv.get("btp_leaderboard")) || [];
    scores.push({
      name: String(name).slice(0, 3).toUpperCase(),
      pin: String(pin || "0000").slice(0, 4),
      score: Number(score),
      level: Number(level) || 1,
      date: new Date().toISOString(),
    });
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 100); // store top 100, serve top 10
    await kv.set("btp_leaderboard", scores);
    return res.status(200).json(scores.slice(0, 10));
  }

  res.status(405).end();
}
