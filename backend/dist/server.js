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
    origin: (origin, callback) => {
        callback(null, true); // erlaubt dynamisch alle Domains
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200
}));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// Root Route
app.get("/", (req, res) => {
    res.json({ message: "Hohenheim Gruppenräume API läuft 🚀" });
});
// 📌 Registrierung
app.post("/auth/register", async (req, res) => {
    try {
        const { email, password, displayName } = req.body;
        if (!email || !password || !displayName) {
            return res.status(400).json({ error: "email, password und displayName sind erforderlich" });
        }
        // Passwort hashen
        const hash = await bcrypt_1.default.hash(password, 10);
        const user = await prisma.users.create({
            data: {
                uni_email: email,
                password_hash: hash,
                display_name: displayName,
                role: "student",
            },
        });
        // JWT erzeugen
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.uni_email }, process.env.JWT_SECRET, { expiresIn: "7d" });
        res.status(201).json({
            message: "Registrierung erfolgreich",
            userId: user.id,
            token,
        });
    }
    catch (err) {
        console.error("Registrierungsfehler:", err);
        res.status(500).json({ error: "Registrierung fehlgeschlagen" });
    }
});
// 📌 Login
app.post("/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.users.findUnique({
            where: { uni_email: email },
        });
        if (!user) {
            return res.status(400).json({ error: "Benutzer existiert nicht" });
        }
        const isValid = await bcrypt_1.default.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(400).json({ error: "Falsches Passwort" });
        }
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.uni_email }, process.env.JWT_SECRET, { expiresIn: "7d" });
        res.json({
            message: "Login erfolgreich",
            token,
            userId: user.id,
        });
    }
    catch (err) {
        console.error("Loginfehler:", err);
        res.status(500).json({ error: "Login fehlgeschlagen" });
    }
});
// 📌 Aktuellen Benutzer abrufen
app.get("/me", async (req, res) => {
    try {
        const auth = req.headers.authorization;
        if (!auth) {
            return res.status(401).json({ error: "Kein Token übermittelt" });
        }
        const token = auth.replace("Bearer ", "");
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        const user = await prisma.users.findUnique({
            where: { id: decoded.userId },
        });
        if (!user) {
            return res.status(404).json({ error: "Benutzer nicht gefunden" });
        }
        res.json({
            name: user.display_name,
            email: user.uni_email,
            id: user.id,
        });
    }
    catch (err) {
        res.status(401).json({ error: "Token ungültig" });
    }
});
// 📌 Alle Räume abrufen
app.get("/rooms", async (req, res) => {
    try {
        const rooms = await prisma.rooms.findMany({
            orderBy: { name: "asc" }
        });
        res.json(rooms);
    }
    catch (err) {
        console.error("Fehler beim Abrufen der Räume:", err);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});
// 📌 Einzelnen Raum abrufen
app.get("/rooms/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const room = await prisma.rooms.findUnique({
            where: { id },
        });
        if (!room) {
            return res.status(404).json({ error: "Raum nicht gefunden" });
        }
        res.json(room);
    }
    catch (err) {
        console.error("Fehler beim Abrufen des Raums:", err);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});
// 📌 Verfügbarkeit eines Raums abrufen
app.get("/rooms/:id/availability", async (req, res) => {
    try {
        const roomId = req.params.id;
        const date = req.query.date;
        if (!date) {
            return res.status(400).json({ error: "Parameter ?date=YYYY-MM-DD fehlt" });
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
      ),
      occupied AS (
        SELECT 
          ($1::date + starts_at) AS s,
          ($1::date + ends_at) AS e
        FROM bookings
        WHERE room_id = $2::uuid
          AND date = $1::date
          AND status IN ('pending','confirmed')
      )
      SELECT json_agg(
        json_build_object(
          'start', to_char(start_ts, 'HH24:MI'),
          'end',   to_char(start_ts + interval '30 min', 'HH24:MI')
        )
        ORDER BY start_ts
      ) AS free
      FROM series
      WHERE NOT EXISTS (
        SELECT 1 
        FROM occupied o
        WHERE tsrange(start_ts, start_ts + interval '30 min', '[)')
          && tsrange(o.s, o.e, '[)')
      );
      `, date, roomId);
        res.json({
            roomId,
            date,
            free: result?.[0]?.free ?? []
        });
    }
    catch (err) {
        console.error("Fehler beim Abrufen der Verfügbarkeit:", err);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});
// 📌 BUCHUNG ANLEGEN
app.post("/bookings", async (req, res) => {
    try {
        const { roomId, userId, date, // "2025-01-10"
        start, // "10:00"
        end, // "11:00"
        peopleCount, purpose, } = req.body;
        // --- einfache Validierung ---
        if (!roomId || !userId || !date || !start || !end || !peopleCount) {
            return res
                .status(400)
                .json({ error: "roomId, userId, date, start, end, peopleCount sind erforderlich" });
        }
        // Datum/Zeit für Prisma vorbereiten
        const dateOnly = new Date(date); // wird in @db.Date gespeichert
        const startsAt = new Date(`${date}T${start}:00`);
        const endsAt = new Date(`${date}T${end}:00`);
        // 👉 KEIN Aufruf von valid_opening() mehr hier!
        // Die Öffnungsregeln & Kapazitätschecks macht dein Trigger in der DB.
        const booking = await prisma.bookings.create({
            data: {
                room_id: roomId,
                user_id: userId,
                date: dateOnly,
                starts_at: startsAt,
                ends_at: endsAt,
                people_count: peopleCount,
                purpose,
            },
        });
        return res.status(201).json(booking);
    }
    catch (err) {
        console.error("Fehler bei /bookings:", err);
        // Postgres-Fehlertext an den Client weitergeben (z.B. Trigger-Fehler)
        if (err.meta?.cause) {
            return res.status(400).json({ error: err.meta.cause });
        }
        if (err.message) {
            return res.status(400).json({ error: err.message });
        }
        return res.status(500).json({ error: "Unbekannter Fehler beim Buchen" });
    }
});
// Server starten
// Server starten (TS-kompatibel)
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
