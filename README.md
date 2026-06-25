# LOGIX: Logistics Demand Forecasting Dashboard

This folder contains a premium, interactive web application dashboard designed for the Flipkart Hackathon Demand Forecasting model. It allows users to visualize, explore, and predict demand both interactively and in batch mode.

## 🚀 Key Features

1. **Interactive Demand Console**: A sidebar panel that lets you test different spatial, temporal, road infrastructure, and weather factors, showing real-time demand score predictions and qualitative descriptions.
2. **Interactive Flow Map**: A dark-themed geographical map powered by Leaflet.js.
   - Plots historical **demand hotspots** (geohashes) directly on the map.
   - Click anywhere on the map to pin a coordinate, automatically decodes to a geohash, and updates the console inputs to compute immediate predictions.
3. **Model Insights**: Chart.js visualizations comparing GBDT models (LightGBM, XGBoost, CatBoost, and Ensemble) along with a Feature Importance chart for the linear model coefficients.
4. **Batch CSV Predictor**: Drag and drop a test `.csv` file (like the hackathon's `test.csv`), view a preview table of predictions, and download the finished CSV containing predicted demand levels.
5. **Theme Switching**: Supports both sleek dark mode (default) and standard light mode.
6. **100% Serverless**: Runs entirely in the browser using a lightweight OLS/Ridge model approximation.

---

## 🛠️ How to Run Locally

Since the application runs client-side, you can host it locally with a simple HTTP server:

1. Open a terminal in this `web/` folder.
2. Run the start command:
   ```bash
   npm run dev
   ```
3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

*Alternatively, if you have python installed, you can run:*
```bash
python -m http.server 3000
```

---

## 💾 How the Serverless Engine Works

The dashboard runs fully client-side. Rather than invoking an active Python Flask/FastAPI server (which is slow and expensive to deploy), we compiled model weights directly into `model_weights.json`.

We used `prepare_model.js` (a Node.js script) to:
1. Load `train.csv`.
2. Compute target encodings for categorical columns (mapping geohashes, road types, etc. to average historical demand).
3. Train a Ridge regression model over all features.
4. Export the lookup maps, model coefficients, map bounds, and performance metrics to `model_weights.json`.

If you ever update the training dataset or want to retrain the local linear model, you can run:
```bash
node prepare_model.js
```
This will automatically generate a fresh `model_weights.json` for the frontend.

---

## 🌐 Deployment Guide

Because the application is fully static, you can deploy it in seconds for **free**:

### 1. Netlify Drop (Easiest)
- Go to [Netlify Drop](https://app.netlify.com/drop).
- Drag and drop this `web/` folder.
- Within 5 seconds, you will receive a public URL to share!

### 2. GitHub Pages
- Initialize a git repository and push your project to GitHub.
- Go to repository **Settings** > **Pages**.
- Set the source to **Deploy from a branch** (e.g. `main` branch) and specify the `/web` folder (or push only the contents of `/web` to a repository and select `/root`).
- Save, and your app will be online in a minute!

### 3. Vercel / Firebase Hosting
- Run `vercel` or `firebase init` inside this directory and follow the prompts to deploy instantly.
