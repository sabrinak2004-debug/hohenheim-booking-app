import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

// --- ROOT ---
app.get("/", (req, res) => {
  res.json({ message: "Hohenheim Gruppenräume API läuft 🚀" });
});

// --- REGISTRIERUNG ---
app.post("/auth/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password || !displayName) {
      return res.status(400).json({ error: "email, password und displayName sind erforderlich" });
    }

    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.users.create({
      data: {
        uni_email: email,
        password_hash: hash,
        display_name: displayName,
        role: "student",
      },
    });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: "7d" });

    res.status(201).json({ token, userId: user.id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registrierung fehlgeschlagen" });
  }
});

// --- LOGIN ---
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.users.findUnique({
      where: { uni_email: email },
    });

    if (!user) return res.status(400).json({ error: "Benutzer existiert nicht" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: "Falsches Passwort" });

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    res.json({ token, userId: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login fehlgeschlagen" });
  }
});

// --- BENUTZER ---
app.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Kein Token übermittelt" });

    const token = auth.replace("Bearer ", "");
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

    const user = await prisma.users.findUnique({ where: { id: decoded.userId } });

    if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden" });

    res.json({
      id: user.id,
      name: user.display_name,
      email: user.uni_email,
    });

  } catch (err) {
    res.status(401).json({ error: "Token ungültig" });
  }
});

// --- RÄUME ---
app.get("/rooms", async (req, res) => {
  try {
    const rooms = await prisma.rooms.findMany({ orderBy: { name: "asc" } });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Räume" });
  }
});

// --- RAUM ---
app.get("/rooms/:id", async (req, res) => {
  try {
    const room = await prisma.rooms.findUnique({
      where: { id: req.params.id },
    });

    if (!room) return res.status(404).json({ error: "Raum nicht gefunden" });

    res.json(room);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden des Raumes" });
  }
});

// --- VERFÜGBARKEIT ---
app.get("/rooms/:id/availability", async (req, res) => {
  try {
    const roomId = req.params.id;
    const date = req.query.date as string;

    if (!date) {
      return res.status(400).json({ error: "Parameter ?date=YYYY-MM-DD fehlt" });
    }

    // ← Hier Typ angeben, damit kein Fehler kommt
    const result = await prisma.$queryRawUnsafe<
      { free: { start: string; end: string }[] | null }[]
    >(
      `
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
      `,
      date
    );

    const free = result.length > 0 ? (result[0].free ?? []) : [];

    res.json({ roomId, date, free });

  } catch (err) {
    console.error("Fehler beim Abrufen der Verfügbarkeit:", err);
    res.status(500).json({ error: "Interner Serverfehler" });
  }
});

// --- SERVER START ---
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server läuft auf Port ${PORT}`));
