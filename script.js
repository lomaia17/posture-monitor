let video;
let canvas;
let ctx;
let isMonitoring = false;
let pose;
let lastBadPostureTime = 0;
let alertFrequencyMinutes = 5;
let isFirstFrameProcessed = false; // Track if the first frame is processed
let breakTimer; // Timer for break reminders
let breakInterval = 30 * 60 * 1000; // Default break interval: 30 minutes (in milliseconds)

// Audio objects
let audio = new Audio('bad_posture_sound.mp3'); // Path to your bad posture sound file
let breakReminderAudio = new Audio('alert.mp3'); // Path to your break reminder sound file
let isSoundPlaying = false; // To track the state of the sound

// Show loading spinner
function showLoadingSpinner() {
  const spinner = document.getElementById('loading-spinner');
  spinner.style.display = 'block';
}

// Hide loading spinner
function hideLoadingSpinner() {
  const spinner = document.getElementById('loading-spinner');
  spinner.style.display = 'none';
}

// Show break reminder
function showBreakReminder() {
  const reminder = document.getElementById('break-reminder');
  reminder.style.display = 'block';

  // Play the break reminder sound
  breakReminderAudio.play();
}

// Hide break reminder
function hideBreakReminder() {
  const reminder = document.getElementById('break-reminder');
  reminder.style.display = 'none';

  // Stop and reset the break reminder sound
  breakReminderAudio.pause();
  breakReminderAudio.currentTime = 0; // Reset the sound to the beginning
}

// Start break reminder timer
function startBreakTimer() {
  breakTimer = setTimeout(() => {
    showBreakReminder(); // Show reminder when the timer ends
  }, breakInterval);
}

// Reset break reminder timer
function resetBreakTimer() {
  clearTimeout(breakTimer); // Clear the existing timer
  startBreakTimer(); // Start a new timer
}

// Set up the camera
async function setupCamera() {
  video = document.getElementById('video');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve(video);
      };
      video.onerror = (err) => {
        console.error('Video playback error:', err);
        alert('Error playing video. Please check your camera and browser permissions.');
        throw err;
      };
    });
  } catch (err) {
    console.error('Error accessing webcam:', err);
    alert('Error accessing webcam. Please make sure you have granted camera permissions.');
    throw err;
  }
}

// Load MediaPipe Pose
async function loadMediaPipePose() {
  pose = new Pose({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
    },
  });

  pose.setOptions({
    modelComplexity: 1, // 0 = Lite, 1 = Full, 2 = Heavy
    smoothLandmarks: true,
    enableSegmentation: false,
    smoothSegmentation: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  pose.onResults(onPoseResults);
}

// Helper function to calculate the angle between three points
function calculateAngle(a, b, c) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const cb = { x: b.x - c.x, y: b.y - c.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const cross = ab.x * cb.y - ab.y * cb.x;
  const angle = Math.atan2(cross, dot) * (180 / Math.PI);
  return Math.abs(angle);
}

// Helper function to calculate arm angle
function calculateArmAngle(shoulder, elbow, wrist) {
  return calculateAngle(shoulder, elbow, wrist);
}

// Function to check if posture is bad
function isPostureBad(landmarks) {
  const nose = landmarks[0]; // MediaPipe Pose landmark index for nose
  const leftShoulder = landmarks[11]; // MediaPipe Pose landmark index for left shoulder
  const rightShoulder = landmarks[12]; // MediaPipe Pose landmark index for right shoulder
  const leftElbow = landmarks[13]; // MediaPipe Pose landmark index for left elbow
  const rightElbow = landmarks[14]; // MediaPipe Pose landmark index for right elbow
  const leftWrist = landmarks[15]; // MediaPipe Pose landmark index for left wrist
  const rightWrist = landmarks[16]; // MediaPipe Pose landmark index for right wrist;

  if (
    nose &&
    leftShoulder &&
    rightShoulder &&
    leftElbow &&
    rightElbow &&
    leftWrist &&
    rightWrist
  ) {
    // Calculate midpoints and distances
    const shoulderMidpoint = {
      x: (leftShoulder.x + rightShoulder.x) / 2,
      y: (leftShoulder.y + rightShoulder.y) / 2,
    };

    // Calculate horizontal distance between nose and shoulders
    const headForwardDistance = nose.x - shoulderMidpoint.x;

    // Calculate shoulder tilt
    const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y);

    // Calculate arm angles
    const leftArmAngle = calculateArmAngle(leftShoulder, leftElbow, leftWrist);
    const rightArmAngle = calculateArmAngle(rightShoulder, rightElbow, rightWrist);

    // Calculate shoulder width (scale factor)
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);

    // Define thresholds for bad posture
    const BAD_HEAD_FORWARD_THRESHOLD = 0.05; // Adjust based on testing
    const BAD_SHOULDER_TILT_THRESHOLD = 0.1; // Adjust based on testing
    const BAD_ARM_ANGLE_THRESHOLD = 90; // Degrees (elbow angle)
    const MIN_SHOULDER_WIDTH = 0.2; // Minimum shoulder width to detect being too close
    const MAX_SHOULDER_WIDTH = 0.6; // Maximum shoulder width to detect being too close

    // Check for bad posture conditions
    const isHeadForward = headForwardDistance > BAD_HEAD_FORWARD_THRESHOLD;
    const isShoulderTilted = shoulderTilt > BAD_SHOULDER_TILT_THRESHOLD;
    const isArmMisaligned =
      Math.abs(leftArmAngle - 90) > BAD_ARM_ANGLE_THRESHOLD ||
      Math.abs(rightArmAngle - 90) > BAD_ARM_ANGLE_THRESHOLD;

    // Check if the user is too close to the camera
    const isTooClose = shoulderWidth > MAX_SHOULDER_WIDTH || shoulderWidth < MIN_SHOULDER_WIDTH;

    // Return true if any condition is met
    return isHeadForward || isShoulderTilted || isArmMisaligned || isTooClose;
  }
  return false;
}

// Handle pose detection results
function onPoseResults(results) {
  if (!isMonitoring) return;

  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the video feed
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Draw keypoints and skeleton
  if (results.poseLandmarks) {
    drawLandmarks(results.poseLandmarks);
    drawConnectors(results.poseLandmarks, Pose.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });

    // Hide loading spinner after the first frame is processed
    if (!isFirstFrameProcessed) {
      hideLoadingSpinner();
      isFirstFrameProcessed = true;
    }

    // Check posture and update status
    const isBadPosture = isPostureBad(results.poseLandmarks);
    document.getElementById('posture-status').textContent =
      `Posture Status: ${isBadPosture ? 'Bad Posture!' : 'Good Posture'}`;

    // Play sound if bad posture is detected
    if (isBadPosture && !isSoundPlaying) {
      audio.play();
      isSoundPlaying = true;
    }

    // Stop sound if posture improves
    if (!isBadPosture && isSoundPlaying) {
      audio.pause();
      audio.currentTime = 0; // Reset the sound to the beginning
      isSoundPlaying = false;
    }
  }
}

// Draw landmarks on the canvas
function drawLandmarks(landmarks) {
  ctx.beginPath();
  landmarks.forEach(landmark => {
    const { x, y } = landmark;
    ctx.moveTo(x * canvas.width + 5, y * canvas.height);
    ctx.arc(x * canvas.width, y * canvas.height, 5, 0, 2 * Math.PI);
  });
  ctx.fillStyle = 'aqua';
  ctx.fill();
}

// Start monitoring
async function startMonitoring() {
  if (isMonitoring) return;

  try {
    // Show loading spinner
    showLoadingSpinner();

    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    await setupCamera();

    // Increase the size of the video and canvas
    const videoContainer = document.getElementById('video-container');
    videoContainer.classList.add('active'); // Add the 'active' class to increase size

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (!pose) {
      await loadMediaPipePose();
    }

    isMonitoring = true;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;

    // Start break reminder timer
    startBreakTimer();

    // Start sending frames to MediaPipe Pose
    const sendFrame = async () => {
      if (!isMonitoring) return;
      await pose.send({ image: video });
      requestAnimationFrame(sendFrame); // Use requestAnimationFrame for smooth frame updates
    };
    sendFrame();
    
  } catch (err) {
    console.error('Error starting monitoring:', err);
    alert('Error starting monitoring. Please check your camera and MediaPipe setup.');
    hideLoadingSpinner(); // Hide spinner in case of error
  }
}

// Stop monitoring
function stopMonitoring() {
  isMonitoring = false;
  const stream = video.srcObject;
  if (stream) {
    const tracks = stream.getTracks();
    tracks.forEach(track => track.stop());
    video.srcObject = null;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('posture-status').textContent = 'Posture Status: Monitoring Stopped';

  // Stop break reminder timer
  clearTimeout(breakTimer);
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('startBtn').addEventListener('click', startMonitoring);
  document.getElementById('stopBtn').addEventListener('click', stopMonitoring);

  // Close break reminder
  document.getElementById('close-break-reminder').addEventListener('click', () => {
    hideBreakReminder();
    resetBreakTimer(); // Reset the timer after acknowledging the reminder
  });
});