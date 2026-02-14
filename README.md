# HarborWatch AI (Trio API Hackathon Prototype)

A demo-focused web app that monitors YouTube live streams for ship/bird activity using Trio vision endpoints.

## What this prototype uses from Trio API

- `POST /streams/validate`
- `POST /prepare-stream`
- `POST /api/check-once`
- `POST /api/live-monitor`
- `GET /jobs/{job_id}`
- `DELETE /jobs/{job_id}`

## Features

- Paste a YouTube Live URL and validate it
- Prepare and render preview stream
- Preset condition chips: ships, birds, rough waves, fog
- Add custom yes/no conditions
- Manual one-time checks with timestamps and latency
- Auto-scan loop (configurable interval)
- Start Trio monitor jobs and watch live job stats
- Session metrics for demo storytelling

## Local run

1. Copy `.env.example` to `.env` and set your API key.
2. Start the server:

```bash
node server.mjs
```

3. Open:

```text
http://127.0.0.1:8787
```

## Environment variables

- `TRIO_API_KEY` (required)
- `TRIO_BASE_URL` (optional, defaults to `https://trio.machinefi.com`)
- `PORT` (optional, defaults to `8787`)
- `HOST` (optional, defaults to `127.0.0.1`)

## Deploy to Render (Free)

This repo includes `render.yaml` for one-click Blueprint deploy.

1. Push this project to GitHub.
2. In Render, choose **New +** -> **Blueprint**.
3. Connect your GitHub repo and deploy.
4. In Render dashboard, set secret env var:
   - `TRIO_API_KEY=your_real_trio_key`
5. Confirm service env vars:
   - `HOST=0.0.0.0`
   - `TRIO_BASE_URL=https://trio.machinefi.com`
6. Open and test:
   - `https://<your-render-domain>/api/health`

### Free plan notes

- Free web services may spin down after inactivity.
- First request after idle can be slower (cold start).
- For live demo reliability, open the site a few minutes before presenting.

## Notes for demo

- Trio monitor jobs auto-stop after ~10 minutes.
- Trio limits active concurrent jobs (usually 10 max).
- Conditions should be yes/no questions for reliable results.
