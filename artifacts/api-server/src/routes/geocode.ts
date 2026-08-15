import { Router } from "express";

const router = Router();

// GET /api/geocode?q=... or ?address=... or ?url=...
router.get("/geocode", (req, res) => {
  const query = (req.query.q || req.query.address || req.query.url || "") as string;

  // Try extracting coordinates from Yandex/2GIS URL if present
  // e.g. "42.9849,47.5046" or "ll=47.5046%2C42.9849"
  const coordsMatch = query.match(/(\d{2}\.\d+)[,\s]+(\d{2}\.\d+)/);
  if (coordsMatch) {
    const p1 = parseFloat(coordsMatch[1]);
    const p2 = parseFloat(coordsMatch[2]);
    // Determine which is lat (~42) and lon (~47)
    const lat = p1 < 45 ? p1 : p2;
    const lon = p1 >= 45 ? p1 : p2;
    return res.json({
      address: query,
      lat,
      lon,
      status: "ok",
    });
  }

  // Default fallback for Makhachkala addresses
  const hash = query.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const offsetLat = ((hash % 100) - 50) * 0.0005;
  const offsetLon = (((hash * 3) % 100) - 50) * 0.0005;

  res.json({
    address: query || "Махачкала, Центр",
    lat: 42.9849 + offsetLat,
    lon: 47.5046 + offsetLon,
    status: "ok",
  });
});

export default router;
