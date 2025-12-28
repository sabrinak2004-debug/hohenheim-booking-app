import { prisma } from "./prisma";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser"
import bcrypt from "bcrypt"; 
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config(); 

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    callback(null, true); // erlaubt dynamisch alle Domains
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200
}));


app.use(express.json());
app.use(cookieParser());


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
    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.users.create({
      data: {
        uni_email: email,
        password_hash: hash,
        display_name: displayName,
        role: "student",
      },
    });

    // JWT erzeugen
    const token = jwt.sign(
      { userId: user.id, email: user.uni_email },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "Registrierung erfolgreich",
      userId: user.id,
      token,
    });

  } catch (err: any) {
    console.error("Registrierungsfehler:", err);
    res.status(500).json({ error: "Registrierung fehlgeschlagen" });
  }
});

// 📌 Login
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1) Benutzer anhand Uni-Mail suchen
    const user = await prisma.users.findUnique({
      where: { uni_email: email },
    });

    if (!user) {
      return res.status(400).json({ error: "Benutzer existiert nicht" });
    }

    // 2) Passwort prüfen
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(400).json({ error: "Falsches Passwort" });
    }

    // 3) JWT erzeugen
    const token = jwt.sign(
      { userId: user.id, email: user.uni_email },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login erfolgreich",
      token,
      userId: user.id,
    });

  } catch (err) {
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };

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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
    console.error("Fehler beim Abrufen des Raums:", err);
    res.status(500).json({ error: "Interner Serverfehler" });
  }
});

// 📌 Verfügbarkeit eines Raums abrufen
app.get("/rooms/:id/availability", async (req, res) => {
  try {
    const roomId = req.params.id;
    const date = req.query.date as string;

    if (!date) {
      return res.status(400).json({ error: "Parameter ?date=YYYY-MM-DD fehlt" });
    }

    const result: any = await prisma.$queryRawUnsafe(
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
      `,
      date,
      roomId
    );

    res.json({
      roomId,
      date,
      free: result?.[0]?.free ?? []
    });

  } catch (err) {
    console.error("Fehler beim Abrufen der Verfügbarkeit:", err);
    res.status(500).json({ error: "Interner Serverfehler" });
  }
  });

app.post("/bookings", async (req, res) => {
  console.log("POST /bookings – raw body:", req.body);

  try {
    // Body auslesen (falls req.body undefined ist, auf {} fallen)
    const {
      roomId,
      userId,
      date,
      start,
      end,
      peopleCount,
      purpose,
    } = req.body || {};

    // Datum als Date-Objekt
    const dateOnly = new Date(date); // entspricht dem Tag, z. B. 2025-11-22

    // Startzeit in ein volles DateTime umwandeln
    const [startHour, startMin] = String(start).split(":").map(Number);
    const startsAt = new Date(dateOnly);
    startsAt.setHours(startHour, startMin, 0, 0);

    // Endzeit in ein volles DateTime umwandeln
    const [endHour, endMin] = String(end).split(":").map(Number);
    const endsAt = new Date(dateOnly);
    endsAt.setHours(endHour, endMin, 0, 0);

    // Eintrag in bookings-Tabelle mit richtigen Typen anlegen
    const booking = await prisma.bookings.create({
      data: {
        room_id: roomId,
        user_id: userId,
        date: dateOnly,                  // Prisma-Feld `date` (Date / DateTime)
        starts_at: startsAt,             // jetzt ein gültiges DateTime
        ends_at: endsAt,                 // auch DateTime
        people_count: Number(peopleCount),
        purpose: purpose ?? "",
      },
    });

    res.status(201).json(booking);
  } catch (err: any) {
    console.error("Fehler beim Anlegen der Buchung:", err);

    // ✅ DB-Fehlermeldung (z.B. aus Trigger: "Die Bibliothek ist an diesem Tag geschlossen.")
    const dbMsg =
      err?.meta?.cause ||                     // Prisma legt Ursache manchmal hier ab
      err?.cause?.message ||                  // oder hier
      (typeof err?.message === "string"
        ? err.message.match(/message:\s*"([^"]+)"/)?.[1]  // fallback: aus String extrahieren
        : null) ||
      "Fehler beim Buchen";

    // ✅ Wenn es ein Trigger/Business-Rule Fehler ist (P0001), dann 400
    const pgCode =
      err?.code ||                            // manchmal direkt
      err?.meta?.code ||                      // manchmal hier
      (typeof err?.message === "string"
        ? err.message.match(/code:\s*"([^"]+)"/)?.[1]
        : null);

    const status = pgCode === "P0001" ? 400 : 500;

    return res.status(status).json({
      error: dbMsg,
    });
  }
});

app.get("/users/:userId/bookings", async (req, res) => {
  try {
    const userId = req.params.userId;

    const bookings = await prisma.bookings.findMany({
      where: { user_id: userId },
      orderBy: [{ date: "asc" }, { starts_at: "asc" }],
      include: { rooms: true },
    });

    return res.json(bookings); // ✅ wichtig
  } catch (err: any) {
    console.error("Fehler beim Abrufen der eigenen Buchungen:", err);

    if (res.headersSent) return; // ✅ verhindert doppelte Antwort

    return res.status(500).json({ error: "Interner Serverfehler" });
  }
});



// 📌 Öffnungszeiten abrufen
app.get("/opening-hours", async (req, res) => {
  try {
    const hours = await prisma.opening_hours.findMany({
      orderBy: { weekday: "asc" }
    });
    res.json(hours);
  } catch (err) {
    console.error("Fehler beim Abrufen der Öffnungszeiten:", err);
    res.status(500).json({ error: "Interner Serverfehler" });
  }
});
// 📌 Schließtage / Feiertage
app.get("/exceptions", async (req, res) => {
  try {
    const exceptions = await prisma.exceptions.findMany({
      orderBy: { date: "asc" }
    });
    res.json(exceptions);
  } catch (err) {
    console.error("Fehler beim Abrufen der Feiertage:", err);
    res.status(500).json({ error: "Interner Serverfehler" });
  }
});

app.patch("/bookings/:id/cancel", async (req, res) => {
  try {
    const id = req.params.id;

    const booking = await prisma.bookings.update({
      where: { id },
      data: { status: "cancelled" }, // ✅ genau dein Statuswert
    });

    return res.json(booking);
  } catch (err: any) {
    console.error("Cancel-Fehler:", err);

    const dbMsg =
      err?.meta?.cause ||
      err?.cause?.message ||
      (typeof err?.message === "string"
        ? err.message.match(/message:\s*"([^"]+)"/)?.[1]
        : null) ||
      "Stornierung fehlgeschlagen";

    return res.status(400).json({ error: dbMsg });
  }
});



// 📌 Gebuchte Slots eines Raums an einem Datum abrufen (Prisma-kompatibel)
app.get("/bookings/by-room-and-date", async (req, res) => {
  const roomId = req.query.roomId as string;
  const dateStr = req.query.date as string; // "YYYY-MM-DD"

  if (!roomId || !dateStr) {
    return res.status(400).json({ error: "roomId und date sind erforderlich" });
  }

  // Für Prisma: Date-Range über den Tag bauen (UTC), statt String-Gleichheit
  const day = new Date(`${dateStr}T00:00:00.000Z`);
  const next = new Date(day);
  next.setUTCDate(day.getUTCDate() + 1);

  try {
    // 1) Bevorzugt: Prisma mit Tages-Range
    const bookings = await prisma.bookings.findMany({
      where: {
        room_id: roomId,
        date: { gte: day, lt: next }, // <-- kein String-Vergleich!
        status: { in: ["pending", "confirmed"] },
      },
      orderBy: { starts_at: "asc" },
    });

    return res.json(bookings);
  } catch (err) {
    console.error("Prisma-Range-Query fehlgeschlagen, versuche RAW:", err);

    // 2) Fallback: RAW-SQL (falls Spalte als DATE vorliegt o.Ä.)
    try {
      const rows: any = await prisma.$queryRawUnsafe(
        `
        SELECT *
        FROM bookings
        WHERE room_id = $1::uuid
          AND date = $2::date
          AND status IN ('pending','confirmed')
        ORDER BY starts_at ASC;
        `,
        roomId,
        dateStr
      );

      return res.json(rows);
    } catch (inner) {
      console.error("RAW-Fallback ebenfalls fehlgeschlagen:", inner);
      return res.status(500).json({ error: "Fehler beim Laden der gebuchten Zeiten" });
    }
  }
});

// 📌 Eigene Buchungen abrufen (z. B. für "My Bookings"-Seite)
app.get("/bookings/me", async (req, res) => {
  try {
// 1) Token prüfen
const auth = req.headers.authorization;
if (!auth) {
  return res.status(401).json({ error: "Kein Token übermittelt" });
}

const token = auth.replace("Bearer ", "");

let decoded: any;
try {
  decoded = jwt.verify(token, process.env.JWT_SECRET!);
} catch (err) {
  return res.status(401).json({ error: "Token ungültig" });
}

if (!decoded || typeof decoded !== "object" || !decoded.userId) {
  return res.status(401).json({ error: "Token ungültig oder userId fehlt" });
}

// 2) Buchungen laden
const bookings = await prisma.bookings.findMany({
  where: { user_id: decoded.userId },
  orderBy: { date: "asc" },
  include: {
    rooms: true,
  },
});

res.json(bookings);
    // 3) Antwort senden
    res.json(bookings);

  } catch (err) {
    console.error("Fehler beim Abrufen der eigenen Buchungen:", err);
    res.status(401).json({ error: "Token ungültig" });
  }
});

// 📌 Öffnungszeiten abrufen (für Sidebar im Frontend)
app.get("/opening-hours", async (req, res) => {
  try {
    const hours = await prisma.opening_hours.findMany({
      orderBy: { weekday: "asc" }
    });

    res.json(hours);

  } catch (err) {
    console.error("Fehler beim Abrufen der Öffnungszeiten:", err);
    res.status(500).json({ error: "Interner Serverfehler" });
  }
});
// 📌 Feiertage / Schließtage abrufen
app.get("/exceptions", async (req, res) => {
  try {
    const exceptions = await prisma.exceptions.findMany({
      orderBy: { date: "asc" }
    });

    res.json(exceptions);

  } catch (err) {
    console.error("Fehler beim Abrufen der Feiertage:", err);
    res.status(500).json({ error: "Interner Serverfehler" });
  }
});

// Server starten
// Server starten (TS-kompatibel)
const PORT = Number(process.env.PORT) || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf Port ${PORT}`);
});