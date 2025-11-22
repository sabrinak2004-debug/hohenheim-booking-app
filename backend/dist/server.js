"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: (origin, callback) => callback(null, true),
    credentials: true
}));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// ---------------- ROOT ----------------
app.get("/", (req, res) => {
    res.json({ message: "Hohenheim Gruppenräume API läuft 🚀" });
});
// ---------------- REGISTER ----------------
app.post("/auth/register", async (req, res) => {
    try {
        const { email, password, displayName } = req.body;
        if (!email || !password || !displayName) {
            return res.status(400).json({ error: "email, password, displayName fehlen" });
        }
        const hash = await bcrypt_1.default.hash(password, 10);
        const user = await prisma.users.create({
            data: {
                uni_email: email,
                password_hash: hash,
                display_name: displayName,
                role: "student",
            },
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, {
            expiresIn: "7d",
        });
        res.status(201).json({ token, userId: user.id });
    }
    catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ error: "Registrierung fehlgeschlagen" });
    }
});
// ---------------- LOGIN ----------------
app.post("/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.users.findUnique({
            where: { uni_email: email },
        });
        if (!user)
            return res.status(400).json({ error: "Benutzer existiert nicht" });
        const ok = await bcrypt_1.default.compare(password, user.password_hash);
        if (!ok)
            return res.status(400).json({ error: "Falsches Passwort" });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, {
            expiresIn: "7d",
        });
        res.json({ token, userId: user.id });
    }
    catch (err) {
        res.status(500).json({ error: "Login fehlgeschlagen" });
    }
});
// ---------------- ME ----------------
app.get("/me", async (req, res) => {
    try {
        const auth = req.headers.authorization;
        if (!auth)
            return res.status(401).json({ error: "Kein Token" });
        const token = auth.replace("Bearer ", "");
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        const user = await prisma.users.findUnique({ where: { id: decoded.userId } });
        if (!user)
            return res.status(404).json({ error: "User nicht gefunden" });
        res.json({
            id: user.id,
            name: user.display_name,
            email: user.uni_email,
        });
    }
    catch (err) {
        res.status(401).json({ error: "Token ungültig" });
    }
});
// ---------------- ROOMS ----------------
app.get("/rooms", async (req, res) => {
    const rooms = await prisma.rooms.findMany({ orderBy: { name: "asc" } });
    res.json(rooms);
});
// Single room
app.get("/rooms/:id", async (req, res) => {
    const room = await prisma.rooms.findUnique({
        where: { id: req.params.id },
    });
    if (!room)
        return res.status(404).json({ error: "Raum nicht gefunden" });
    res.json(room);
});
// ---------------- ROOM AVAILABILITY ----------------
app.get("/rooms/:id/availability", async (req, res) => {
    try {
        const roomId = req.params.id;
        const date = req.query.date;
        if (!date) {
            return res.status(400).json({ error: "?date fehlt" });
        }
        const result = await prisma.$queryRawUnsafe(`
      WITH bounds AS (
        SELECT
          COALESCE(ex.opens, oh.opens) AS opens,
          COALESCE(ex.closes, oh.closes) AS closes
        FROM opening_hours oh
        LEFT JOIN exceptions ex ON ex.date = $1::date
        WHERE oh.weekday = EXTRACT(DOW FROM $1::date)
      ),
      series AS (
        SELECT generate_series(
            ($1::date + (SELECT opens FROM bounds)),
            ($1::date + (SELECT closes FROM bounds) - interval '30 min'),
            interval '30 min'
        ) AS start_ts
      )
      SELECT json_agg(
        json_build_object(
          'start', to_char(start_ts, 'HH24:MI'),
          'end',   to_char(start_ts + interval '30 min', 'HH24:MI')
        )
      ) AS free
      FROM series
      `, date);
        res.json({
            roomId,
            date,
            free: result[0]?.free ?? []
        });
    }
    catch (err) {
        console.error("Availability error:", err);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});
// ---------------- CREATE BOOKING ----------------
app.post("/bookings", async (req, res) => {
    try {
        const { roomId, userId, date, start, end, peopleCount, purpose } = req.body;
        if (!roomId || !userId || !date || !start || !end || !peopleCount) {
            return res.status(400).json({ error: "Pflichtfelder fehlen" });
        }
        const booking = await prisma.bookings.create({
            data: {
                room_id: roomId,
                user_id: userId,
                date: new Date(date),
                starts_at: new Date(`${date}T${start}:00`),
                ends_at: new Date(`${date}T${end}:00`),
                people_count: peopleCount,
                purpose: purpose ?? "",
            }
        });
        res.status(201).json(booking);
    }
    catch (err) {
        console.error("Booking error:", err);
        return res.status(500).json({
            error: err.meta?.cause ?? err.message ?? "Unbekannter Fehler"
        });
    }
});
// ---------------- BOOKINGS BY ROOM + DATE ----------------
app.get("/bookings/by-room-and-date", async (req, res) => {
    const roomId = req.query.roomId;
    const dateStr = req.query.date;
    if (!roomId || !dateStr) {
        return res.status(400).json({ error: "roomId und date fehlen" });
    }
    const day = new Date(`${dateStr}T00:00:00.000Z`);
    const next = new Date(day);
    next.setUTCDate(day.getUTCDate() + 1);
    const bookings = await prisma.bookings.findMany({
        where: {
            room_id: roomId,
            date: { gte: day, lt: next },
            status: { in: ["pending", "confirmed"] },
        },
        orderBy: { starts_at: "asc" },
    });
    res.json(bookings);
});
// ---------------- MY BOOKINGS ----------------
app.get("/bookings/me", async (req, res) => {
    const userId = req.query.userId;
    if (!userId)
        return res.status(400).json({ error: "?userId fehlt" });
    const bookings = await prisma.bookings.findMany({
        where: { user_id: userId },
        include: { rooms: true },
        orderBy: { date: "asc" },
    });
    res.json(bookings);
});
// ---------------- SERVER START ----------------
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server läuft auf Port ${PORT}`));
