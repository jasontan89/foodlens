// Single combined prompt — sends image once, gets extraction + AI analysis together
// This replaces the previous two-call approach which was timing out on Vercel free plan (10s limit)
function buildCombinedPrompt(profile) {
  const profileText = profile
    ? `User profile: Age ${profile.age}, ${profile.gender}, ${profile.weight}kg, height ${profile.height}cm, activity: ${profile.activity}, goal: ${profile.goal}.`
    : "No user profile — give general nutrition advice.";

  return `You are an expert nutritionist and food label analyst.

${profileText}

Carefully read the food label in this image. Extract all nutrition data AND provide a full AI analysis.
Return ONLY a valid JSON object — no markdown, no code fences, no explanation. Raw JSON only.
Keep ALL individual string values under 100 characters to avoid truncation.

{
  "productName": "",

  "imageQuality": {
    "isLabel": true,
    "isLegible": true,
    "issues": []
  },

  "sectionsDetected": {
    "nutritionPanel": true,
    "ingredientList": false,
    "allergenWarning": false,
    "nutriGrade": null
  },

  "servingInfo": {
    "servingSize": { "value": null, "unit": "g" },
    "servingsPerPack": null
  },

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

  "ingredients": [
    { "rank": 1, "name": "", "type": "", "allergen": null, "eNumber": null, "concern": null }
  ],
  "topThreeIngredients": [],
  "allergensSummary": [],
  "additiveCount": 0,
  "rawIngredientText": "",
  "confidence": 0.0,

  "aiAnalysis": {
    "aiScore": 0,
    "aiGrade": "F",
    "aiGradeColor": "#E53E3E",
    "aiLabel": "Avoid",
    "verdict": "Direct 2-3 sentence verdict here.",
    "whatIsInIt": [
      { "nutrient": "Calories",  "icon": "🔥", "status": "OK",   "statusColor": "#D97706", "value": "66 kcal per 100ml", "analogy": "", "implication": "One sentence impact." },
      { "nutrient": "Protein",   "icon": "💪", "status": "GOOD", "statusColor": "#2F855A", "value": "3g per 100ml",      "analogy": "", "implication": "One sentence impact." },
      { "nutrient": "Total Fat", "icon": "🫙", "status": "OK",   "statusColor": "#D97706", "value": "3.9g per 100ml",   "analogy": "", "implication": "One sentence impact." },
      { "nutrient": "Sat. Fat",  "icon": "🧈", "status": "HIGH", "statusColor": "#E53E3E", "value": "2.4g per 100ml",   "analogy": "", "implication": "One sentence impact." },
      { "nutrient": "Sugar",     "icon": "🍬", "status": "OK",   "statusColor": "#D97706", "value": "4.8g per 100ml",   "analogy": "", "implication": "One sentence impact." },
      { "nutrient": "Fibre",     "icon": "🌿", "status": "POOR", "statusColor": "#E53E3E", "value": "0g per 100ml",     "analogy": "", "implication": "One sentence impact." },
      { "nutrient": "Sodium",    "icon": "🧂", "status": "GOOD", "statusColor": "#2F855A", "value": "42mg per 100ml",   "analogy": "", "implication": "One sentence impact." }
    ],
    "redFlags": [],
    "greenFlags": [],
    "smarterSwap": "One sentence swap or encouragement.",
    "novaGroup": 1,
    "novaLabel": "Unprocessed"
  }
}

EXTRACTION rules:
- All nutritionPer100g values must be numbers, never strings
- If label shows per-serving only, calculate per 100g using the serving size
- ml and g are treated as equivalent
- Rank ingredients by position (rank 1 = first = highest quantity)
- Ingredient type: grain/protein/dairy/fat/sweetener/additive/flavouring/preservative/emulsifier/colouring/vegetable/fruit/other
- Include E-numbers in eNumber field
- rawIngredientText = verbatim text from label
- confidence = 0.0 to 1.0

AI ANALYSIS rules:
- aiScore 0-100: sugar 25%, saturated fat 20%, sodium 20%, fibre 15%, protein 10%, processing 10%
- Penalise for trans fat present, sugar in top 3 ingredients, 4+ additives
- aiGrade: A=80-100, B=60-79, C=40-59, D=20-39, F=0-19
- aiGradeColor: A=#2F855A, B=#38A169, C=#D97706, D/F=#E53E3E
- aiLabel: Excellent / Good / Moderate / Poor / Avoid
- verdict: 2-3 sentences, direct and specific, mention user goal if profile given
- whatIsInIt: exactly 7 entries (calories, protein, totalFat, saturatedFat, sugars, dietaryFibre, sodium)
  - status: EXCELLENT / GOOD / OK / HIGH / LOW / POOR
  - statusColor: #2F855A=good, #D97706=ok/moderate, #E53E3E=bad
  - analogy: relatable comparison or empty string if not helpful
  - implication: one short sentence, max 80 chars
- redFlags: max 4 items, each under 70 chars, specific concerns only
- greenFlags: genuine positives only, max 4 items, each under 70 chars, empty array if none
- smarterSwap: one sentence under 120 chars. If grade A or B, write encouragement instead
- novaGroup: 1=unprocessed, 2=processed ingredients, 3=processed, 4=ultra-processed`;
}

function parseJSON(raw) {
  // Strip markdown fences
  let cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try extracting just the outermost JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        throw new Error(`Could not parse Gemini response. Starts with: ${cleaned.substring(0, 150)}`);
      }
    }
    throw new Error(`No JSON found in response. Starts with: ${cleaned.substring(0, 150)}`);
  }
}

async function callGemini(apiKey, parts) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          // Flash-Lite models support explicit thinking levels (minimal/low/medium/high).
          // "low" gives enough reasoning for nutrition judgment + JSON structuring
          // without the latency cost of "medium"/"high" — keeps us well under
          // Vercel's 10s timeout on the free plan.
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini error ${res.status}`);
  }

  const data = await res.json();

  // Warn if Gemini stopped for a reason other than natural completion
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    console.warn(`Gemini finishReason: ${finishReason} — may indicate truncation`);
  }

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

  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }
  if (!imageBase64) {
    return res.status(400).json({ error: "imageBase64 is required" });
  }

  try {
    // Single call — image + combined extraction & analysis prompt
    const prompt = buildCombinedPrompt(profile);
    const raw = await callGemini(apiKey, [
      { inline_data: { mime_type: mimeType, data: imageBase64 } },
      { text: prompt },
    ]);

    const result = parseJSON(raw);

    // ── Normalize nutritionPer100g — Gemini's JSON mode isn't schema-enforced,
    // so it can occasionally drift (string numbers, missing unit, wrong nesting).
    // This guarantees every field has the exact { value: number|null, unit: string } shape
    // the frontend expects, regardless of what Gemini actually returned.
    const NUTRIENT_UNITS = {
      calories: "kcal", protein: "g", totalFat: "g", saturatedFat: "g",
      transFat: "g", totalCarbs: "g", sugars: "g", dietaryFibre: "g", sodium: "mg",
    };
    const rawNutrition = result.nutritionPer100g || {};
    const normalizedNutrition = {};
    let missingCount = 0;

    for (const [key, defaultUnit] of Object.entries(NUTRIENT_UNITS)) {
      const field = rawNutrition[key];
      let value = null;

      if (field && typeof field === "object" && field.value !== undefined) {
        // Expected shape: { value: ..., unit: ... }
        value = field.value;
      } else if (typeof field === "number" || typeof field === "string") {
        // Gemini sometimes flattens to a bare number/string instead of an object
        value = field;
      }

      // Coerce to a real number, or null if it can't be parsed
      if (value !== null && value !== undefined && value !== "") {
        const num = Number(value);
        value = Number.isFinite(num) ? num : null;
      } else {
        value = null;
      }

      if (value === null) missingCount++;
      normalizedNutrition[key] = { value, unit: (field && field.unit) || defaultUnit };
    }

    result.nutritionPer100g = normalizedNutrition;

    if (missingCount > 0) {
      console.warn(`nutritionPer100g had ${missingCount}/9 fields missing or malformed after normalization`);
    }
    if (missingCount >= 7) {
      console.error("Nutrition extraction likely failed - raw response:", JSON.stringify(rawNutrition).substring(0, 300));
    }

    // Safety check — if aiAnalysis missing from response, set null
    // so frontend falls back gracefully instead of crashing
    if (!result.aiAnalysis || typeof result.aiAnalysis.aiScore !== "number") {
      console.warn("aiAnalysis missing or malformed in Gemini response");
      result.aiAnalysis = null;
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error("Analysis error:", err.message);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
