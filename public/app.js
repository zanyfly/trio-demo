const state = {
  autoScanTimer: null,
  autoScanWindowTimer: null,
  detections: [],
  jobs: new Map(),
  jobsPollTimer: null,
  metrics: {
    birdHits: 0,
    checks: 0,
    latencySum: 0,
    positive: 0,
    shipHits: 0
  }
};

const el = {
  autoScanBtn: document.querySelector('#autoScanBtn'),
  birdMetric: document.querySelector('#birdMetric'),
  checksMetric: document.querySelector('#checksMetric'),
  clearTimelineBtn: document.querySelector('#clearTimelineBtn'),
  customCondition: document.querySelector('#customCondition'),
  jobsList: document.querySelector('#jobsList'),
  latencyMetric: document.querySelector('#latencyMetric'),
  logOutput: document.querySelector('#logOutput'),
  positiveMetric: document.querySelector('#positiveMetric'),
  prepareBtn: document.querySelector('#prepareBtn'),
  previewHint: document.querySelector('#previewHint'),
  scanInterval: document.querySelector('#scanInterval'),
  scanOnceBtn: document.querySelector('#scanOnceBtn'),
  shipMetric: document.querySelector('#shipMetric'),
  startJobsBtn: document.querySelector('#startJobsBtn'),
  stopAutoScanBtn: document.querySelector('#stopAutoScanBtn'),
  stopJobsBtn: document.querySelector('#stopJobsBtn'),
  streamUrl: document.querySelector('#streamUrl'),
  timelineList: document.querySelector('#timelineList'),
  timelineTemplate: document.querySelector('#timelineItemTemplate'),
  validateBtn: document.querySelector('#validateBtn'),
  videoFrame: document.querySelector('#videoFrame')
};

const chips = Array.from(document.querySelectorAll('.chip'));

function nowLabel() {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date());
}

function log(message, level = 'info') {
  const prefix = level.toUpperCase().padEnd(5, ' ');
  const line = `[${nowLabel()}] ${prefix} ${message}`;
  const current = el.logOutput.textContent;
  el.logOutput.textContent = `${line}\n${current}`.trimEnd();
}

function normalizeCondition(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.endsWith('?') ? trimmed : `${trimmed}?`;
}

function selectedConditions() {
  const values = chips
    .filter((chip) => chip.classList.contains('active'))
    .map((chip) => chip.dataset.condition)
    .filter(Boolean);

  const custom = normalizeCondition(el.customCondition.value);
  if (custom) {
    values.push(custom);
  }

  return [...new Set(values)];
}

function currentStreamUrl() {
  const url = el.streamUrl.value.trim();
  if (!url) {
    throw new Error('Please enter a livestream URL.');
  }
  return url;
}

function makeEmbedUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    if (parsed.hostname.includes('youtube.com')) {
      const id = parsed.searchParams.get('v');
      if (id) {
        return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1`;
      }
      if (parsed.pathname.startsWith('/embed/')) {
        return inputUrl;
      }
      if (parsed.pathname.startsWith('/live/')) {
        const liveId = parsed.pathname.split('/').filter(Boolean).at(-1);
        if (liveId) {
          return `https://www.youtube.com/embed/${liveId}?autoplay=1&mute=1`;
        }
      }
    }

    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.replace('/', '');
      if (id) {
        return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1`;
      }
    }
  } catch {
    return '';
  }
  return '';
}

async function callApi(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json'
    },
    ...options
  });

  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { raw: rawText };
  }

  if (!response.ok) {
    const message = payload?.detail || payload?.error || JSON.stringify(payload);
    throw new Error(message);
  }

  return payload;
}

function renderTimeline() {
  el.timelineList.innerHTML = '';
  if (state.detections.length === 0) {
    el.timelineList.innerHTML = '<article class="timeline-item">No checks yet.</article>';
    return;
  }

  for (const item of state.detections.slice().reverse()) {
    const fragment = el.timelineTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.timeline-item');
    root.querySelector('.tag').textContent = item.tag;
    root.querySelector('.timestamp').textContent = item.timestamp;
    root.querySelector('.condition').textContent = item.condition;
    root.querySelector('.explanation').textContent = item.explanation;

    const resultNode = root.querySelector('.result');
    resultNode.textContent = item.triggered ? 'Triggered: YES' : 'Triggered: NO';
    resultNode.className = item.triggered ? 'result result-hit' : 'result result-miss';

    root.querySelector('.latency').textContent = `${item.trioLatency} ms Trio · ${item.roundTripMs} ms total`;
    el.timelineList.appendChild(fragment);
  }
}

function renderMetrics() {
  const m = state.metrics;
  const avg = m.checks > 0 ? Math.round(m.latencySum / m.checks) : 0;
  el.checksMetric.textContent = String(m.checks);
  el.positiveMetric.textContent = String(m.positive);
  el.shipMetric.textContent = String(m.shipHits);
  el.birdMetric.textContent = String(m.birdHits);
  el.latencyMetric.textContent = `${avg} ms`;
}

function addDetection(item) {
  state.detections.push(item);

  state.metrics.checks += 1;
  state.metrics.latencySum += item.trioLatency;
  if (item.triggered) {
    state.metrics.positive += 1;
  }

  const lower = item.condition.toLowerCase();
  if (item.triggered && lower.includes('ship')) {
    state.metrics.shipHits += 1;
  }
  if (item.triggered && lower.includes('bird')) {
    state.metrics.birdHits += 1;
  }

  renderTimeline();
  renderMetrics();
}

function renderJobs() {
  const jobs = Array.from(state.jobs.values());
  if (jobs.length === 0) {
    el.jobsList.innerHTML = '<article class="job-item">No active Trio monitor jobs.</article>';
    return;
  }

  el.jobsList.innerHTML = jobs
    .map((job) => {
      const stats = job.stats || {};
      return `
        <article class="job-item">
          <strong>${job.condition}</strong>
          <span>Job ID: <code>${job.id}</code></span>
          <span>Status: ${job.status || 'unknown'}</span>
          <span>Executions: ${stats.execution_count ?? 0} | Triggers: ${stats.trigger_count ?? 0}</span>
          <span>Trigger Rate: ${stats.trigger_rate ?? 'n/a'} | Avg Latency: ${stats.avg_latency_ms ?? stats.avg_latency ?? 'n/a'}</span>
          <span>Estimated Cost: ${stats.estimated_cost ?? 'n/a'}</span>
        </article>
      `;
    })
    .join('');
}

async function validateStream() {
  const url = currentStreamUrl();
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
    throw new Error('Only YouTube Live URLs are currently supported by this demo.');
  }
  const payload = await callApi('/api/streams/validate', {
    body: JSON.stringify({ url }),
    method: 'POST'
  });

  const valid = payload.valid ?? payload.is_valid ?? false;
  log(valid ? 'Stream validated as playable/live.' : 'Stream failed Trio validation.', valid ? 'info' : 'warn');

  if (!valid) {
    throw new Error('Trio rejected this URL. Ensure it is an active YouTube LIVE stream.');
  }
}

async function preparePreview() {
  const url = currentStreamUrl();
  const fallback = makeEmbedUrl(url);

  let previewUrl = fallback;
  try {
    const payload = await callApi('/api/prepare-stream', {
      body: JSON.stringify({ url }),
      method: 'POST'
    });

    previewUrl =
      payload.embed_url ||
      payload.prepared_url ||
      payload.stream_url ||
      payload.url ||
      fallback;
  } catch (error) {
    log(`Prepare stream endpoint failed: ${error.message}. Falling back to YouTube embed parsing.`, 'warn');
  }

  if (!previewUrl) {
    throw new Error('Unable to build preview URL. Use a standard YouTube watch URL.');
  }

  el.videoFrame.src = previewUrl;
  el.videoFrame.style.display = 'block';
  el.previewHint.style.display = 'none';
  log('Live preview ready.');
}

async function runSingleCheck(condition, tag = 'check-once') {
  const url = currentStreamUrl();
  const started = performance.now();

  const payload = await callApi('/api/check-once', {
    body: JSON.stringify({
      condition,
      includeFrame: false,
      model: 'default',
      skipValidation: true,
      url
    }),
    method: 'POST'
  });

  const roundTripMs = Math.round(performance.now() - started);
  const trioLatency = Number(payload.duration_ms ?? roundTripMs);

  addDetection({
    condition,
    explanation: payload.explanation || 'No explanation provided by Trio.',
    roundTripMs,
    tag,
    timestamp: nowLabel(),
    trioLatency,
    triggered: Boolean(payload.triggered)
  });

  log(`${tag} | ${condition} -> ${payload.triggered ? 'YES' : 'NO'} (${trioLatency} ms Trio latency)`);
}

async function runScan(tag = 'check-once') {
  const conditions = selectedConditions();
  if (conditions.length === 0) {
    throw new Error('Select at least one preset condition or add a custom condition.');
  }

  await Promise.all(conditions.map((condition) => runSingleCheck(condition, tag)));
}

function startAutoScan() {
  if (state.autoScanTimer) {
    log('Auto-scan is already running.', 'warn');
    return;
  }

  const intervalSec = Number(el.scanInterval.value) || 30;
  const intervalMs = intervalSec * 1000;

  runScan('auto-scan').catch((error) => log(`Auto-scan failed: ${error.message}`, 'warn'));
  state.autoScanTimer = setInterval(() => {
    runScan('auto-scan').catch((error) => log(`Auto-scan failed: ${error.message}`, 'warn'));
  }, intervalMs);
  state.autoScanWindowTimer = setTimeout(() => {
    stopAutoScan();
    log('Auto-scan reached 10 minutes and stopped to match Trio monitor windows.', 'warn');
  }, 10 * 60 * 1000);

  log(`Auto-scan started: every ${intervalSec}s.`);
}

function stopAutoScan() {
  if (!state.autoScanTimer) {
    return;
  }
  clearInterval(state.autoScanTimer);
  state.autoScanTimer = null;
  if (state.autoScanWindowTimer) {
    clearTimeout(state.autoScanWindowTimer);
    state.autoScanWindowTimer = null;
  }
  log('Auto-scan stopped.');
}

async function startMonitorJobs() {
  const url = currentStreamUrl();
  const conditions = selectedConditions();

  if (conditions.length === 0) {
    throw new Error('Select at least one condition before creating monitor jobs.');
  }

  if (conditions.length > 10) {
    throw new Error('Trio allows up to 10 concurrent jobs.');
  }

  for (const condition of conditions) {
    const response = await callApi('/api/live-monitor', {
      body: JSON.stringify({
        condition,
        includeFrame: false,
        model: 'default',
        pollingInterval: 15,
        skipValidation: true,
        url
      }),
      method: 'POST'
    });

    const jobId = response.job_id || response.id || response.jobId;
    if (!jobId) {
      log(`Live monitor started for condition "${condition}" but no job_id returned.`, 'warn');
      continue;
    }

    state.jobs.set(jobId, {
      condition,
      id: jobId,
      status: response.status || 'processing',
      stats: null
    });
    log(`Started Trio monitor job ${jobId} for: ${condition}`);
  }

  renderJobs();
  ensureJobsPolling();
}

function ensureJobsPolling() {
  if (state.jobsPollTimer) {
    return;
  }

  state.jobsPollTimer = setInterval(async () => {
    if (state.jobs.size === 0) {
      clearInterval(state.jobsPollTimer);
      state.jobsPollTimer = null;
      return;
    }

    await Promise.all(
      Array.from(state.jobs.keys()).map(async (jobId) => {
        try {
          const response = await callApi(`/api/jobs/${encodeURIComponent(jobId)}`, {
            method: 'GET'
          });

          const item = state.jobs.get(jobId);
          if (!item) {
            return;
          }

          item.status = response.status || item.status;
          item.stats = response.stats || item.stats;

          if (item.status === 'completed' || item.status === 'failed') {
            log(`Job ${jobId} is ${item.status}.`);
          }
        } catch (error) {
          log(`Failed polling job ${jobId}: ${error.message}`, 'warn');
        }
      })
    );

    renderJobs();
  }, 7000);
}

async function stopAllJobs() {
  const ids = Array.from(state.jobs.keys());
  if (ids.length === 0) {
    log('No jobs to stop.');
    return;
  }

  await Promise.all(
    ids.map(async (id) => {
      try {
        await callApi(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
        log(`Requested cancellation for job ${id}.`);
      } catch (error) {
        log(`Could not cancel ${id}: ${error.message}`, 'warn');
      }
    })
  );

  state.jobs.clear();
  renderJobs();
}

function resetTimeline() {
  state.detections = [];
  state.metrics = {
    birdHits: 0,
    checks: 0,
    latencySum: 0,
    positive: 0,
    shipHits: 0
  };
  renderTimeline();
  renderMetrics();
  log('Timeline and metrics reset.');
}

function bindEvents() {
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
    });
  });

  el.validateBtn.addEventListener('click', async () => {
    try {
      await validateStream();
    } catch (error) {
      log(error.message, 'warn');
    }
  });

  el.prepareBtn.addEventListener('click', async () => {
    try {
      await preparePreview();
    } catch (error) {
      log(error.message, 'warn');
    }
  });

  el.scanOnceBtn.addEventListener('click', async () => {
    try {
      await runScan('manual');
    } catch (error) {
      log(error.message, 'warn');
    }
  });

  el.autoScanBtn.addEventListener('click', () => {
    try {
      startAutoScan();
    } catch (error) {
      log(error.message, 'warn');
    }
  });

  el.stopAutoScanBtn.addEventListener('click', stopAutoScan);

  el.startJobsBtn.addEventListener('click', async () => {
    try {
      await startMonitorJobs();
    } catch (error) {
      log(error.message, 'warn');
    }
  });

  el.stopJobsBtn.addEventListener('click', async () => {
    await stopAllJobs();
  });

  el.clearTimelineBtn.addEventListener('click', resetTimeline);
}

function init() {
  bindEvents();
  renderTimeline();
  renderJobs();
  renderMetrics();
  log('HarborWatch ready. Validate your stream, then start scanning.');
}

init();
