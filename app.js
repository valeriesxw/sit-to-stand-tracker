// ============================================================================
// Sit-to-Stand Lab
// Runs MediaPipe's Pose Landmarker entirely in the browser (WASM/WebGL) so the
// camera feed never leaves the device. Rep-counting logic mirrors the
// reference Python/OpenCV implementation this page is based on.
// ============================================================================

import {
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ---- Tunables (match the original Python script) --------------------------
const TEST_DURATION = 30;       // seconds
const SITTING_ANGLE = 110;      // degrees, below this counts as "sitting"
const STANDING_ANGLE = 160;     // degrees, above this (from sitting) counts a rep
const RESTART_HOLD_SECONDS = 2; // seconds a raised hand must be held to reset
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

// Landmark indices, same as the MediaPipe Pose model used in Python.
const L = { NOSE: 0, L_WRIST: 15, R_WRIST: 16, L_HIP: 23, L_KNEE: 25, L_ANKLE: 27 };

// Pairs of landmark indices to draw as skeleton connectors.
const CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [27, 31],
  [24, 26], [26, 28], [28, 30], [28, 32],
];

// ---- DOM references ---------------------------------------------------------
const startScreen = document.getElementById("startScreen");
const testScreen = document.getElementById("testScreen");
const startBtn = document.getElementById("startBtn");
const startError = document.getElementById("startError");

const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const engineDot = document.getElementById("engineDot");
const engineStatus = document.getElementById("engineStatus");

const detectionTag = document.getElementById("detectionTag");
const detectionText = document.getElementById("detectionText");

const angleValue = document.getElementById("angleValue");
const needle = document.getElementById("needle");
const timeValue = document.getElementById("timeValue");
const countValue = document.getElementById("countValue");
const stageValue = document.getElementById("stageValue");

const gestureHint = document.getElementById("gestureHint");
const progressFill = document.getElementById("progressFill");

const completeOverlay = document.getElementById("completeOverlay");
const finalCount = document.getElementById("finalCount");
const restartFromComplete = document.getElementById("restartFromComplete");
const restartBtn = document.getElementById("restartBtn");
const stopBtn = document.getElementById("stopBtn");

// ---- State (mirrors the Python script's globals) ---------------------------
let count = 0;
let stage = "ready";        // "ready" | "sitting" | "standing"
let kneeAngle = null;
let testStartTime = null;   // seconds
let testComplete = false;

let handRaised = false;
let handRaiseStart = null;
let restartProgress = 0;
let restartArmed = true;
let waitingForHandDown = false;

let poseLandmarker = null;
let stream = null;
let rafId = null;
let running = false;

// ---- Geometry ----------------------------------------------------------------
function calculateAngle(hip, knee, ankle) {
  const a1 = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const a2 = Math.atan2(ankle.y - knee.y, ankle.x - knee.x);
  let angle = Math.abs(((a1 - a2) * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

// ---- Setup -------------------------------------------------------------------
async function initLandmarker() {
  engineStatus.textContent = "Loading model…";
  const filesetResolver = await FilesetResolver.forVisionTasks(WASM_URL);
  poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  engineStatus.textContent = "Engine ready";
  engineDot.classList.add("live");
}

async function startCamera() {
  startBtn.disabled = true;
  startError.hidden = true;
  try {
    if (!poseLandmarker) await initLandmarker();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 960, height: 720, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 720;

    startScreen.hidden = true;
    testScreen.hidden = false;
    running = true;
    resetTest(false);
    rafId = requestAnimationFrame(renderLoop);
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startError.textContent =
      err && err.name === "NotAllowedError"
        ? "Camera access was denied. Allow camera permissions and try again."
        : "Couldn't start the camera or load the pose model. Check your connection and try again.";
    startError.hidden = false;
  }
}

function stopCamera() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  testScreen.hidden = true;
  startScreen.hidden = false;
  startBtn.disabled = false;
}

// ---- Reset / restart -----------------------------------------------------
function resetTest(keepWaitingForHandDown) {
  count = 0;
  stage = "ready";
  kneeAngle = null;
  testStartTime = null;
  testComplete = false;
  handRaiseStart = null;
  restartProgress = 0;
  waitingForHandDown = keepWaitingForHandDown;
  completeOverlay.hidden = true;
}

// ---- Main detection + state machine loop -----------------------------------
let lastVideoTime = -1;

function renderLoop() {
  if (!running) return;

  if (video.currentTime !== lastVideoTime && poseLandmarker) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, performance.now());
    processFrame(result);
  }

  rafId = requestAnimationFrame(renderLoop);
}

function processFrame(result) {
  const bodyDetected = !!(result.landmarks && result.landmarks.length > 0);
  const currentTime = performance.now() / 1000;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (bodyDetected) {
    const landmarks = result.landmarks[0];
    const nose = landmarks[L.NOSE];
    const leftWrist = landmarks[L.L_WRIST];
    const rightWrist = landmarks[L.R_WRIST];

    const leftHandUp = (leftWrist.visibility ?? 1) > 0.5 && leftWrist.y < nose.y;
    const rightHandUp = (rightWrist.visibility ?? 1) > 0.5 && rightWrist.y < nose.y;
    handRaised = leftHandUp || rightHandUp;

    if (handRaised && restartArmed) {
      if (handRaiseStart === null) handRaiseStart = currentTime;
      const held = currentTime - handRaiseStart;
      restartProgress = Math.min(1, held / RESTART_HOLD_SECONDS);

      if (held >= RESTART_HOLD_SECONDS) {
        resetTest(true);
        restartArmed = false;
        handRaiseStart = null;
        restartProgress = 0;
      }
    } else if (!handRaised) {
      handRaiseStart = null;
      restartProgress = 0;
      restartArmed = true;
      if (waitingForHandDown) waitingForHandDown = false;
    }

    const hip = landmarks[L.L_HIP];
    const knee = landmarks[L.L_KNEE];
    const ankle = landmarks[L.L_ANKLE];
    kneeAngle = calculateAngle(hip, knee, ankle);

    if (!waitingForHandDown && !handRaised && testStartTime === null) {
      testStartTime = currentTime;
      stage = kneeAngle < SITTING_ANGLE ? "sitting" : "standing";
    }

    if (testStartTime !== null && !testComplete && !handRaised && !waitingForHandDown) {
      if (kneeAngle < SITTING_ANGLE) {
        stage = "sitting";
      } else if (kneeAngle > STANDING_ANGLE && stage === "sitting") {
        stage = "standing";
        count += 1;
        countValue.classList.remove("pulse");
        void countValue.offsetWidth; // restart animation
        countValue.classList.add("pulse");
      }
    }

    drawSkeleton(landmarks);
  } else {
    kneeAngle = null;
    handRaised = false;
    handRaiseStart = null;
    restartProgress = 0;
  }

  let timeLeft;
  if (testStartTime === null) {
    timeLeft = TEST_DURATION;
  } else {
    const elapsed = currentTime - testStartTime;
    timeLeft = Math.max(0, TEST_DURATION - Math.floor(elapsed));
    if (elapsed >= TEST_DURATION) {
      testComplete = true;
      timeLeft = 0;
    }
  }

  updatePanel({ bodyDetected, timeLeft });
}

// ---- Drawing -----------------------------------------------------------------
function drawSkeleton(landmarks) {
  const w = canvas.width;
  const h = canvas.height;

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(53, 208, 192, 0.75)";
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    const p1 = landmarks[a];
    const p2 = landmarks[b];
    if (!p1 || !p2) continue;
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
  }
  ctx.stroke();

  ctx.fillStyle = "#ffb020";
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- UI sync -------------------------------------------------------------------
function updatePanel({ bodyDetected, timeLeft }) {
  // Detection tag
  detectionTag.classList.toggle("detected", bodyDetected);
  detectionText.textContent = bodyDetected ? "BODY DETECTED" : "MOVE INTO FRAME";

  // Angle + gauge
  angleValue.textContent = kneeAngle === null ? "—" : Math.round(kneeAngle);
  const clamped = Math.max(0, Math.min(180, kneeAngle ?? 90));
  const rotation = (clamped / 180) * 180 - 90;
  needle.style.transform = `rotate(${rotation}deg)`;
  needle.classList.toggle("zone-sit", kneeAngle !== null && kneeAngle < SITTING_ANGLE);
  needle.classList.toggle("zone-stand", kneeAngle !== null && kneeAngle > STANDING_ANGLE);

  // Timer + count
  const mm = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const ss = String(timeLeft % 60).padStart(2, "0");
  timeValue.textContent = `${mm}:${ss}`;
  countValue.textContent = count;

  // Stage pill
  stageValue.textContent = stage.toUpperCase();
  stageValue.classList.toggle("sitting", stage === "sitting");
  stageValue.classList.toggle("standing", stage === "standing");

  // Gesture hint + progress bar
  if (waitingForHandDown) {
    gestureHint.textContent = "Lower your hand to begin the test";
  } else if (handRaised) {
    gestureHint.textContent = "Hold hand up to restart…";
  } else {
    gestureHint.textContent = "Raise a hand above your head to restart";
  }
  progressFill.style.width = `${restartProgress * 100}%`;

  // Completion state
  if (testComplete && completeOverlay.hidden) {
    finalCount.textContent = count;
    completeOverlay.hidden = false;
  }
}

// ---- Controls ------------------------------------------------------------------
startBtn.addEventListener("click", startCamera);
restartFromComplete.addEventListener("click", () => resetTest(handRaised));
restartBtn.addEventListener("click", () => resetTest(handRaised));
stopBtn.addEventListener("click", stopCamera);

window.addEventListener("keydown", (e) => {
  if (testScreen.hidden) return;
  if (e.key === "r" || e.key === "R") resetTest(handRaised);
  if (e.key === "q" || e.key === "Q") stopCamera();
});
