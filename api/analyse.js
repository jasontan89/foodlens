// Extraction prompt — structured data only, no analysis
const EXTRACTION_PROMPT = `You are a food label data extraction engine. Extract all data from this food label image.
Return ONLY a valid JSON object — no markdown, no code fences, no explanation. Raw JSON only.

{
  "productName": "",
  "imageQuality": { "isLabel": true, "isLegible": true, "issues": [] },
  "sectionsDetected": {
    "nutritionPanel": true, "ingredientList": false,
    "allergenWarning": false, "nutriGrade": null
  },
  "servingInfo": { "servingSize": { "value": null, "unit": "g" }, "servingsPerPack": null },
  "nutritionPer100g": {
    "calories":     { "value": null, "unit": "kcal" },
    "protein":      { "value": null, "unit": "g" },
    "totalFat":     { "value": null, "unit": "g" },
    "saturatedFat": { "value": null, "unit": "g" },
    "transFat":     { "value": null, "unit": "g" },
    "totalCarbs":   { "value": null, "unit": "g" },
    "sugars":       { "value": null, "unit": "g" },
    "dietaryFibre": { "value": null, "unit": "g" },
    "sodium":       { "value": null, "unit": "mg" }
  },
  "ingredients": [{ "rank": 1, "name": "", "type": "", "allergen": null, "eNumber": null, "concern": null }],
  "topThreeIngredients": [],
  "allergensSummary": [],
  "additiveCount": 0,
  "rawIngredientText": "",
  "confidence": 0.0
}

Rules:
- All nutritionPer100g values must be numbers, never strings
- If label only shows per-serving values, calculate per 100g using the serving size shown
- ml and g are treated as equivalent
- Rank ingredients by position (rank 1 = first listed = highest quantity)
- Classify ingredient type: grain/protein/dairy/fat/sweetener/additive/flavouring/preservative/emulsifier/colouring/vegetable/fruit/other
- Include E-numbers in eNumber field (e.g. "E471")
- rawIngredientText = verbatim ingredient list from label
- confidence = 0.0 to 1.0`;

// AI analysis prompt — sends nutrition data + profile, returns human verdict
function buildAnalysisPrompt(nutritionData, profile) {
  const profileText = profile
    ? `User profile: Age ${profile.age}, ${profile.gender}, ${profile.weight}kg, height ${profile.height}cm, activity level: ${profile.activity}, goal: ${profile.goal}.`
    : "No user profile provided — give general nutrition advice.";

  return `You are an expert nutritionist reviewing a food product's nutrition data.

${profileText}

Here is the extracted nutrition data per 100g:
${JSON.stringify(nutritionData, null, 2)}

Return ONLY a valid JSON object — no markdown, no code fences. Raw JSON only.

{
  "aiScore": 0,
  "aiGrade": "F",
  "aiGradeColor": "#E53E3E",
  "aiLabel": "Avoid",

  "verdict": "",

  "whatIsInIt": [
    {
      "nutrient": "Sugar",
      "icon": "🍬",
      "status": "HIGH",
      "statusColor": "#E53E3E",
      "value": "28g per 100g",
      "analogy": "About 7 teaspoons of sugar",
      "implication": "High sugar causes energy spikes and crashes"
    }
  ],

  "redFlags": [],
  "greenFlags": [],
  "smarterSwap": "",
  "novaGroup": 4,
  "novaLabel": "Ultra-processed"
}

Rules:
- aiScore: 0–100. Score holistically as a nutritionist. Weight: sugar 25%, saturated fat 20%, sodium 20%, fibre 15%, protein 10%, processing level 10%. Penalise for trans fat, sugar in top 3 ingredients, 4+ additives.
- aiGrade: A (80–100), B (60–79), C (40–59), D (20–39), F (0–19)
- aiGradeColor: A=#2F855A, B=#38A169, C=#D97706, D or F=#E53E3E
- aiLabel: "Excellent" / "Good" / "Moderate" / "Poor" / "Avoid"
- verdict: 2–3 sentences. Be direct and specific. Name the biggest problem and how it relates to the user's goal if profile is given. No filler phrases.
- whatIsInIt: one entry per key nutrient (calories, protein, totalFat, saturatedFat, sugars, dietaryFibre, sodium). For each:
  - status: EXCELLENT / GOOD / OK / HIGH / LOW / POOR
  - statusColor: #2F855A for excellent/good, #D97706 for ok, #E53E3E for high/low/poor
  - analogy: relatable comparison (teaspoons of sugar, eggs-worth of protein). Omit if not helpful.
  - implication: one short sentence on health impact
- redFlags: specific concerns as plain strings e.g. "Sugar is the 2nd ingredient by weight", "Trans fat detected", "4 synthetic additives (E471, E500, E503)", "Ultra-processed (NOVA Group 4)"
- greenFlags: genuine positives only. Empty array if nothing positive — do not invent.
- smarterSwap: one specific realistic alternative with what it improves. If grade A or B, say the food is a good choice and leave this encouraging.
- novaGroup: 1=unprocessed, 2=processed ingredients, 3=processed foods, 4=ultra-processed`;
}

function parseJSON(raw) {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callGemini(apiKey, parts) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini error ${res.status}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { imageBase64, mimeType = "image/jpeg", profile } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });

  try {
    // ── Call 1: Extract structured nutrition data from image ──────────────────
    const extractionText = await callGemini(apiKey, [
      { inline_data: { mime_type: mimeType, data: imageBase64 } },
      { text: EXTRACTION_PROMPT },
    ]);
    const extracted = parseJSON(extractionText);

    // ── Call 2: AI analysis using extracted nutrition + user profile ──────────
    const analysisPrompt = buildAnalysisPrompt(extracted.nutritionPer100g, profile);
    const analysisText = await callGemini(apiKey, [
      { text: analysisPrompt },
    ]);
    const aiAnalysis = parseJSON(analysisText);

    // ── Return both together ──────────────────────────────────────────────────
    return res.status(200).json({ ...extracted, aiAnalysis });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
