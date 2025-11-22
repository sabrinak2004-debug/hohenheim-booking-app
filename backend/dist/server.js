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
// CORS
app.use((0, cors_1.default)({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// ROOT
app.get("/", (req, res) => {
    res.json({ message: "Hohenheim Gruppenräume API läuft 🚀" });
});
// ---------------- AUTH ----------------
app.post("/auth/register", async (req, res) => {
    try {
        const { email, password, displayName } = req.body;
        if (!email || !password || !displayName) {
            return res.status(400).json({ error: "email, password und displayName sind erforderlich" });
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
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
        res.status(201).json({ token, userId: user.id });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Registrierung fehlgeschlagen" });
    }
});
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
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
        res.json({ token, userId: user.id });
    }
    catch (err) {
        res.status(500).json({ error: "Login fehlgeschlagen" });
    }
});
// ---------------- USER ----------------
app.get("/me", async (req, res) => {
    try {
        const auth = req.headers.authorization;
        if (!auth)
            return res.status(401).json({ error: "Kein Token übermittelt" });
        const token = auth.replace("Bearer ", "");
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        const user = await prisma.users.findUnique({ where: { id: decoded.userId } });
        if (!user)
            return res.status(404).json({ error: "Benutzer nicht gefunden" });
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
    try {
        const rooms = await prisma.rooms.findMany({ orderBy: { name: "asc" } });
        res.json(rooms);
    }
    catch (err) {
        res.status(500).json({ error: "Fehler beim Laden der Räume" });
    }
});
app.get("/rooms/:id", async (req, res) => {
    try {
        const room = await prisma.rooms.findUnique({
            where: { id: req.params.id },
        });
        if (!room)
            return res.status(404).json({ error: "Raum nicht gefunden" });
        res.json(room);
    }
    catch (err) {
        res.status(500).json({ error: "Fehler beim Laden des Raumes" });
    }
});
// ---------------- AVAILABILITY ----------------
app.get("/rooms/:id/availability", async (req, res) => {
    try {
        const roomId = req.params.id;
        const date = req.query.date;
        if (!date)
            return res.status(400).json({ error: "Parameter ?date=YYYY-MM-DD fehlt" });
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
        const free = result?.[0]?.free ?? [];
        res.json({ roomId, date, free });
    }
    catch (err) {
        console.error("Fehler beim Abrufen der Verfügbarkeit:", err);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});
// ---------------- BOOKINGS ----------------
app.post("/bookings", async (req, res) => {
    try {
        const { roomId, userId, date, start, end, peopleCount, purpose } = req.body;
        if (!roomId || !userId || !date || !start || !end || !peopleCount) {
            return res.status(400).json({ error: "roomId, userId, date, start, end, peopleCount sind Pflichtfelder" });
        }
        const rows = await prisma.$queryRawUnsafe(`
      INSERT INTO bookings (
        room_id, user_id, date, starts_at, ends_at, people_count, purpose, status
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::date,
        ($3::date + $4::time)::timestamp,
        ($3::date + $5::time)::timestamp,
        $6,
        $7,
        'confirmed'
      )
      RETURNING *;
    `, roomId, userId, date, start, end, Number(peopleCount), purpose ?? null);
        res.status(201).json(rows[0]);
    }
    catch (err) {
        console.error("Fehler beim Anlegen der Buchung:", err);
        res.status(500).json({ error: "Buchung fehlgeschlagen", detail: err.message });
    }
});
// ---------------- SERVER ----------------
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
