import { Router } from "express";

const router = Router();

// GET /api/auth/me
router.get("/auth/me", (req, res) => {
  res.json({ username: "admin" });
});

// POST /api/auth/login
router.post("/auth/login", (req, res) => {
  res.cookie("smartroute_token", "demo-jwt-token", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  res.json({ ok: true, username: req.body?.username || "admin" });
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res) => {
  res.clearCookie("smartroute_token");
  res.json({ ok: true });
});

export default router;
