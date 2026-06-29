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
- ml and g are treated as equivalent for scoring
- Rank ingredients by position (rank 1 = first listed = highest quantity)
- Classify ingredient type: grain/protein/dairy/fat/sweetener/additive/flavouring/preservative/emulsifier/colouring/vegetable/fruit/other
- Include E-numbers in eNumber field (e.g. "E471")
- rawIngredientText = verbatim ingredient list from label
- confidence = 0.0 to 1.0
- Keep all string values SHORT — max 80 characters per string field to avoid truncation`;

// AI analysis prompt
function buildAnalysisPrompt(nutritionData, profile) {
  const profileText = profile
    ? `User: Age ${profile.age}, ${profile.gender}, ${profile.weight}kg, goal: ${profile.goal}, activity: ${profile.activity}.`
    : "No user profile — give general nutrition advice.";

  return `You are an expert nutritionist. Analyse this food's nutrition data.

${profileText}

Nutrition per 100g/ml:
${JSON.stringify(nutritionData)}

Return ONLY a valid JSON object — no markdown, no code fences. Raw JSON only.
Keep ALL string values under 120 characters. Be concise.

{
  "aiScore": 0,
  "aiGrade": "F",
  "aiGradeColor": "#E53E3E",
  "aiLabel": "Avoid",
  "verdict": "2-3 sentence plain English verdict here.",
  "whatIsInIt": [
    { "nutrient": "Calories", "icon": "🔥", "status": "OK", "statusColor": "#D97706", "value": "66 kcal per 100ml", "analogy": "", "implication": "Moderate calorie density." },
    { "nutrient": "Protein",  "icon": "💪", "status": "GOOD", "statusColor": "#2F855A", "value": "3g per 100ml", "analogy": "About 1 egg worth of protein per glass", "implication": "Supports muscle maintenance." },
    { "nutrient": "Total Fat","icon": "🫙", "status": "OK",   "statusColor": "#D97706", "value": "3.9g per 100ml", "analogy": "", "implication": "Moderate fat content." },
    { "nutrient": "Sat. Fat", "icon": "🧈", "status": "HIGH", "statusColor": "#E53E3E", "value": "2.4g per 100ml", "analogy": "", "implication": "Watch saturated fat intake." },
    { "nutrient": "Sugar",    "icon": "🍬", "status": "OK",   "statusColor": "#D97706", "value": "4.8g per 100ml", "analogy": "", "implication": "Naturally occurring lactose." },
    { "nutrient": "Fibre",    "icon": "🌿", "status": "POOR", "statusColor": "#E53E3E", "value": "0g per 100ml",  "analogy": "", "implication": "No fibre — expected for milk." },
    { "nutrient": "Sodium",   "icon": "🧂", "status": "GOOD", "statusColor": "#2F855A", "value": "42mg per 100ml","analogy": "", "implication": "Low sodium." }
  ],
  "redFlags": ["Short flag 1", "Short flag 2"],
  "greenFlags": ["Short positive 1", "Short positive 2"],
  "smarterSwap": "One sentence swap suggestion or encouragement.",
  "novaGroup": 1,
  "novaLabel": "Unprocessed"
}

Scoring rules:
- aiScore 0-100: sugar 25%, saturated fat 20%, sodium 20%, fibre 15%, protein 10%, processing 10%
- Penalise for trans fat, sugar as top-3 ingredient, 4+ additives
- A=80-100, B=60-79, C=40-59, D=20-39, F=0-19
- aiGradeColor: A=#2F855A, B=#38A169, C=#D97706, D/F=#E53E3E
- status values: EXCELLENT / GOOD / OK / HIGH / LOW / POOR
- statusColor: #2F855A=good, #D97706=ok, #E53E3E=bad
- redFlags: max 4 items, each under 60 chars
- greenFlags: genuine positives only, max 4 items, each under 60 chars
- novaGroup: 1=unprocessed, 2=processed ingredients, 3=processed, 4=ultra-processed`;
}

// Strip markdown fences and extract the JSON object robustly
function parseJSON(raw) {
  // Remove markdown code fences
  let cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    // Try extracting just the JSON object if there's extra text around it
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        // Last resort: attempt to repair truncated JSON by closing open structures
        throw new Error(`JSON parse failed. Raw response starts with: ${cleaned.substring(0, 120)}`);
      }
    }
    throw new Error(`No JSON object found in response: ${cleaned.substring(0, 120)}`);
  }
}

async function callGemini(apiKey, parts) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,  // FIX: was 2048 — too small, caused truncation
        },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini error ${res.status}`);
  }
  const data = await res.json();

  // Log finish reason to help debug future truncations
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    console.warn(`Gemini finished with reason: ${finishReason}`);
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

  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });

  try {
    // ── Call 1: Extract structured nutrition data from image ──────────────────
    const extractionText = await callGemini(apiKey, [
      { inline_data: { mime_type: mimeType, data: imageBase64 } },
      { text: EXTRACTION_PROMPT },
    ]);
    const extracted = parseJSON(extractionText);

    // ── Call 2: AI analysis — if this fails, still return extraction data ─────
    let aiAnalysis = null;
    try {
      const analysisPrompt = buildAnalysisPrompt(extracted.nutritionPer100g, profile);
      const analysisText = await callGemini(apiKey, [{ text: analysisPrompt }]);
      aiAnalysis = parseJSON(analysisText);
    } catch (aiErr) {
      // AI analysis failed — log it but don't crash the whole request
      // User still gets rule-based scoring from the extraction data
      console.error("AI analysis call failed:", aiErr.message);
      aiAnalysis = null;
    }

    return res.status(200).json({ ...extracted, aiAnalysis });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
