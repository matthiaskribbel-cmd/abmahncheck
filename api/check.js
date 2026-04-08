export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { bewertung, name, email } = req.body;

  if (!bewertung || !email) {
    return res.status(400).json({ error: 'Bewertung und E-Mail sind erforderlich.' });
  }

  // ── KI-Prüfung ──
  let klassifikation = 'C';
  let begruendung = '';

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Du bist ein sehr strenger Experte für deutsches Abmahnrecht, spezialisiert auf Abmahnungen wegen Online-Bewertungen.

Analysiere folgenden Bewertungstext und klassifiziere ihn als A, B oder C.

Vergib A NUR wenn ALLE folgenden Bedingungen erfüllt sind:
1. Der Text ist eindeutig eine subjektive Meinungsäusserung ("war schlecht", "unfreundlich", "enttäuschend", "nicht empfehlenswert", "schlechter Service" etc.)
2. Es sind KEINE konkreten überprüfbaren Tatsachenbehauptungen enthalten
3. Eine Abmahnung dagegen wäre offensichtlich rechtsmissbräuchlich

Vergib B wenn:
- Der Text sowohl Meinungen als auch konkrete Aussagen enthält
- Die Einordnung als Meinung vs. Tatsache unklar ist

Vergib C wenn:
- Der Text konkrete Vorwürfe enthält (Betrug, Diebstahl, Hygieneverstösse, strafrechtliches etc.)
- Der Text übertrieben oder beleidigend ist
- Es unklar ist ob es eine echte Bewertungssituation ist
- Im Zweifel immer C

Standard ist C. A ist die Ausnahme, nicht die Regel.

BEWERTUNGSTEXT:
${bewertung}

Antworte NUR in folgendem JSON-Format ohne weitere Erklärung:
{"klassifikation": "C", "begruendung": "Kurze Begründung in 1-2 Sätzen auf Deutsch"}`
        }]
      })
    });

    const data = await anthropicRes.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    klassifikation = parsed.klassifikation || 'C';
    begruendung = parsed.begruendung || '';
  } catch (err) {
    console.error('KI-Fehler:', err);
    klassifikation = 'B';
    begruendung = 'Automatische Prüfung nicht möglich, manuelle Prüfung erforderlich.';
  }

  // ── E-Mail an dich via Resend ──
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'abmahncheck.legal <onboarding@resend.dev>',
        to: ['info@abmahncheck.legal'],
        subject: `[${klassifikation}] Neuer Fall von ${name || email}`,
        html: `
          <h2>Neuer Fall – Klassifikation: ${klassifikation}</h2>
          <p><strong>Begründung KI:</strong> ${begruendung}</p>
          <hr>
          <p><strong>Name:</strong> ${name || 'nicht angegeben'}</p>
          <p><strong>E-Mail:</strong> ${email}</p>
          <hr>
          <p><strong>Bewertungstext:</strong></p>
          <p>${bewertung}</p>
        `
      })
    });
  } catch (err) {
    console.error('E-Mail Fehler:', err);
  }

  // ── Antwort an den Nutzer ──
  if (klassifikation === 'A' || klassifikation === 'B') {
    return res.status(200).json({
      ergebnis: 'positiv',
      nachricht: 'Ihre Unterlagen sehen vielversprechend aus. Ein Spezialist prüft Ihren Fall und meldet sich innerhalb von 24 Stunden bei Ihnen.'
    });
  } else {
    return res.status(200).json({
      ergebnis: 'negativ',
      nachricht: 'Leider eignet sich Ihr Fall nicht für unser Modell. Auf Wunsch leiten wir Ihre Unterlagen direkt an einen spezialisierten Anwalt weiter – kostenlos und unverbindlich.'
    });
  }
}
