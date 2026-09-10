# Portfolio

Personal portfolio with interactive machine learning and quantum computing demos.
Built with Next.js (App Router), TypeScript and Tailwind CSS, deployed on Vercel.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Structure

```
app/
  page.tsx              Home: intro and live QAOA landscape
  ai/                   Machine learning section, one folder per demo
  quantum/              Quantum computing section, one folder per demo
components/             Shared UI (demo page shell, section lists, hero figure)
lib/content.ts          All site copy and the demo catalogue
lib/landscape.ts        Analytic p = 1 QAOA landscape and viridis colormap
public/models/          Browser-side models (e.g. YOLO ONNX)
public/data/            Precomputed results (forecasts, VQE runs)
python/                 Offline training and export scripts
```

To add or edit a demo, change `lib/content.ts`. To make a demo live, pass the
interactive component as children to `DemoPage` in its `page.tsx` and set its
`status` to `"live"`.

## Deploy

1. Push the repository to GitHub.
2. In Vercel, choose Add New → Project and import the repository. No settings need changing.
3. Later demos need API keys: copy the names from `.env.example` into
   Project → Settings → Environment Variables.

Every push to `main` deploys to production; every pull request gets a preview URL.
