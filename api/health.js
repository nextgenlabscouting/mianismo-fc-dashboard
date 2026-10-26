module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  return res.status(200).json({
    status: "ok",
    project: "MIANISMO FC",
    service: "Sorare public read-only API",
    runtime: "Vercel Functions",
    timestamp: new Date().toISOString()
  });
};
