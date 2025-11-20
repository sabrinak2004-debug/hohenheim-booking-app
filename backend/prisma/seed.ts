import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // -----------------------------
  // 1) Räume
  // -----------------------------
  await prisma.rooms.createMany({
    data: [
      {
        name: "Gruppenraum 1",
        location: "Foyer",
        capacity: 8,
        description:
          "Gruppenraum im Foyer mit großem Wandmonitor und HDMI-Anschluss.",
        features: ["WLAN", "Großer Wandmonitor", "HDMI-Anschluss"],
      },
      {
        name: "Gruppenraum 2",
        location: "Foyer",
        capacity: 8,
        description: "Gruppenraum im Foyer für bis zu 8 Personen.",
        features: ["WLAN"],
      },
      {
        name: "Gruppenraum 3",
        location: "Foyer",
        capacity: 8,
        description: "Gruppenraum im Foyer für bis zu 8 Personen.",
        features: ["WLAN"],
      },
      {
        name: "Gruppenraum 4",
        location: "Foyer",
        capacity: 8,
        description: "Gruppenraum im Foyer für bis zu 8 Personen.",
        features: ["WLAN"],
      },
      {
        name: "Gruppenraum 5",
        location: "1. Obergeschoss",
        capacity: 14,
        description:
          "Größter Gruppenraum (~35 qm) mit flexiblem Mobiliar; 8–14 Personen; geeignet auch für Stand-ups.",
        features: [
          "WLAN",
          "2 höhenverstellbare Tische/Whiteboards",
          "12 Trapeztische",
          "12 höhenverstellbare Drehstühle",
          "4 höhenverstellbare Hocker",
          "4 Hochstühle",
          "Rollbarer TFT-Monitor",
          "3 Akustiktrennwände",
          "Flexibles Mobiliar",
        ],
      },
      {
        name: "Gruppenraum 6",
        location: "Obergeschoss",
        capacity: 6,
        description:
          "Gruppenraum im Obergeschoss mit großem Wandmonitor und HDMI-Anschluss.",
        features: ["WLAN", "Großer Wandmonitor", "HDMI-Anschluss"],
      },
      {
        name: "Gruppenraum 7",
        location: "Obergeschoss",
        capacity: 6,
        description: "Gruppenraum im Obergeschoss für bis zu 6 Personen.",
        features: ["WLAN"],
      },
      {
        name: "Gruppenraum 8",
        location: "Obergeschoss",
        capacity: 6,
        description: "Gruppenraum im Obergeschoss für bis zu 6 Personen.",
        features: ["WLAN"],
      },
    ],
  });

  console.log("✅ Räume eingefügt.");

  // -----------------------------
  // 2) Öffnungszeiten
  // -----------------------------
  const openingHours = [
    { weekday: 0, opens: "10:00", closes: "21:00", is_closed: false }, // Sonntag
    { weekday: 1, opens: "08:00", closes: "21:00", is_closed: false }, // Montag
    { weekday: 2, opens: "08:00", closes: "21:00", is_closed: false },
    { weekday: 3, opens: "08:00", closes: "21:00", is_closed: false },
    { weekday: 4, opens: "08:00", closes: "21:00", is_closed: false },
    { weekday: 5, opens: "08:00", closes: "21:00", is_closed: false },
    { weekday: 6, opens: "10:00", closes: "21:00", is_closed: false }, // Samstag
  ];

  await prisma.opening_hours.createMany({ data: openingHours });

  console.log("✅ Öffnungszeiten eingefügt.");

  // -----------------------------
  // 3) Feiertage (Beispiele)
  // -----------------------------
  await prisma.exceptions.createMany({
    data: [
      { date: new Date("2025-01-01"), is_closed: true, reason: "Neujahr" },
      {
        date: new Date("2025-12-25"),
        is_closed: true,
        reason: "1. Weihnachtsfeiertag",
      },
      {
        date: new Date("2025-12-26"),
        is_closed: true,
        reason: "2. Weihnachtsfeiertag",
      },
    ],
  });

  console.log("✅ Feiertage eingefügt.");

  console.log("🌱 Seed complete!");
}

// Start
main()
  .catch((e) => {
    console.error("❌ Fehler beim Seeden:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
