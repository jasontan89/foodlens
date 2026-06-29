# FoodLens 🍃 — Vercel Full-Stack Deployment

AI food label scanner. One repo, one Vercel deployment. No separate backend needed.

## Structure

```
foodlens-vercel/
├── api/
│   └── analyse.js       ← Serverless function (Gemini proxy)
├── src/
│   ├── main.jsx
│   └── App.jsx          ← Full React app
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

## How it works

```
Browser → POST /api/analyse → Vercel Serverless Function → Gemini API
```

The `/api/analyse.js` file is automatically deployed as a serverless function by Vercel.
The React frontend calls `/api/analyse` as a relative URL — works in both dev and production.

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit - FoodLens"
git branch -M main
git remote add origin https://github.com/jasontan89/foodlens.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to vercel.com → New Project
2. Import your `foodlens` GitHub repo
3. Framework preset: **Vite** (auto-detected)
4. No environment variables needed
5. Click Deploy

Done — Vercel handles both the React frontend and the `/api/analyse` serverless function.

### 3. Open on your phone

Visit your Vercel URL, enter your Gemini API key, and start scanning.

## Local Development

```bash
npm install
npm run dev
# Opens http://localhost:5173
# /api calls are proxied to Vercel dev server automatically via vite.config.js
```

For local dev with the API function working, install Vercel CLI:
```bash
npm i -g vercel
vercel dev
# Opens http://localhost:3000 with both frontend and API working
```

## Getting a Free Gemini API Key

1. Go to aistudio.google.com
2. Sign in with Google
3. Click Get API key → Create API key
4. Paste into the app
