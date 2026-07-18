import { execFile } from "node:child_process";
import { spawn } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
const startedAt = performance.now();
const child = spawn(options.helper, [], { stdio: ["pipe", "pipe", "pipe"] });
const metrics = {
  protocol: options.protocol,
  duration_ms: options.duration,
  first_frame_ms: null,
  frames: 0,
  full_frames: 0,
  delta_frames: 0,
  frame_payload_bytes: 0,
  wire_bytes: 0,
  max_rss_kib: 0,
  average_cpu_percent: 0,
  statuses: [],
};
let stdout = Buffer.alloc(0);
let pendingPayload = null;
let cpuSamples = [];

child.stdout.on("data", (chunk) => {
  metrics.wire_bytes += chunk.length;
  stdout = Buffer.concat([stdout, chunk]);
  drainOutput();
});
child.stderr.on("data", (chunk) => {
  const text = chunk.toString().trim();
  if (text) metrics.statuses.push(`stderr: ${text.slice(0, 300)}`);
});

writeRequest({
  type: "Connect",
  destination: options.destination,
  username: options.username,
  password: options.password,
  domain: null,
  width: options.width,
  height: options.height,
  scale_factor: options.scaleFactor,
});

const activity = setInterval(() => {
  const elapsed = performance.now() - startedAt;
  const x = Math.floor((elapsed / 7) % options.width);
  const y = Math.floor((elapsed / 11) % options.height);
  writeRequest({ type: "MouseMove", x, y });
  if (Math.floor(elapsed / 500) !== Math.floor((elapsed - 33) / 500)) {
    writeRequest({ type: "Wheel", vertical: true, units: 120 });
  }
}, 33);

const sampler = setInterval(sampleProcess, 500);
setTimeout(() => writeRequest({ type: "Close" }), options.duration);
setTimeout(() => child.kill("SIGTERM"), options.duration + 3000);

child.on("exit", (code, signal) => {
  clearInterval(activity);
  clearInterval(sampler);
  metrics.exit_code = code;
  metrics.signal = signal;
  metrics.elapsed_ms = Math.round(performance.now() - startedAt);
  metrics.average_cpu_percent = average(cpuSamples);
  metrics.frames_per_second = round(metrics.frames / (options.duration / 1000));
  metrics.mebibytes_per_second = round(
    metrics.frame_payload_bytes / 1024 / 1024 / (options.duration / 1000),
  );
  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
});

function drainOutput() {
  while (true) {
    if (pendingPayload) {
      if (stdout.length < pendingPayload.length) return;
      stdout = stdout.subarray(pendingPayload.length);
      recordFrame(pendingPayload.type, pendingPayload.length);
      pendingPayload = null;
      continue;
    }
    const newline = stdout.indexOf(0x0a);
    if (newline < 0) return;
    const line = stdout.subarray(0, newline).toString();
    stdout = stdout.subarray(newline + 1);
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      metrics.statuses.push(`invalid event: ${line.slice(0, 160)}`);
      continue;
    }
    const payloadLength = event.bgra_len ?? event.rgba_len ?? 0;
    if (payloadLength > 0) {
      pendingPayload = { type: event.type, length: payloadLength };
      continue;
    }
    if (event.type === "Frame" && event.rgba_base64) {
      recordFrame(event.type, Buffer.byteLength(event.rgba_base64, "base64"));
    } else if (event.message) {
      metrics.statuses.push(`${event.type}: ${event.message}`);
    }
  }
}

function recordFrame(type, bytes) {
  if (metrics.first_frame_ms === null) {
    metrics.first_frame_ms = Math.round(performance.now() - startedAt);
  }
  metrics.frames += 1;
  metrics.frame_payload_bytes += bytes;
  if (type === "FrameBgraRects") metrics.delta_frames += 1;
  else metrics.full_frames += 1;
}

function writeRequest(request) {
  if (!child.stdin.destroyed) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }
}

function sampleProcess() {
  execFile("ps", ["-o", "%cpu=,rss=", "-p", String(child.pid)], (error, stdoutText) => {
    if (error) return;
    const [cpu, rss] = stdoutText.trim().split(/\s+/).map(Number);
    if (Number.isFinite(cpu)) cpuSamples.push(cpu);
    if (Number.isFinite(rss)) metrics.max_rss_kib = Math.max(metrics.max_rss_kib, rss);
  });
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    parsed[args[index].replace(/^--/, "")] = args[index + 1];
  }
  for (const required of ["helper", "protocol", "destination"]) {
    if (!parsed[required]) throw new Error(`missing --${required}`);
  }
  return {
    helper: parsed.helper,
    protocol: parsed.protocol,
    destination: parsed.destination,
    username: parsed.username || null,
    password: parsed.password || null,
    duration: Number(parsed.duration || 10000),
    width: Number(parsed.width || 1280),
    height: Number(parsed.height || 720),
    scaleFactor: Number(parsed.scaleFactor || 100),
  };
}

function average(values) {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
