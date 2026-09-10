# Offline scripts

Python code that runs outside Vercel: model training, exports and precomputed results.
Outputs are written to `public/models` and `public/data` so the site can load them as static files.

Planned contents:

- `vision/` – export YOLO11n to ONNX for in-browser inference.
- `time_series/` – fetch Red Eléctrica data, train forecasters, write forecast JSON (run daily by a GitHub Action).
- `quantum/` – export VQE results and landscapes from the research repos.
