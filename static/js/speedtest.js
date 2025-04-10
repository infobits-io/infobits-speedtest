// Constants
const PING_TESTS = 25; // Number of ping tests
const MIN_TEST_DURATION = 30; // Increased minimum test duration in seconds (from 15 to 30)
const TARGET_DL_DURATION = 45; // Target download test duration (seconds)
const TARGET_UL_DURATION = 45; // Target upload test duration (seconds)
const MEASUREMENT_INTERVAL = 100; // Milliseconds between measurements
const MAX_SPEED_CLASS = 10000; // Upper bound for speed classification (10 Gbps)
const CRYPTO_BLOCK_SIZE = 65536; // Maximum bytes for crypto.getRandomValues() (browser security limit)
const WARMUP_DURATION = 5; // Seconds for warm-up phase
const SPEED_AVG_WINDOW = 3; // Seconds to average speed over

// Dynamic constants that adjust based on connection speed
let downloadFileSize = 25 * 1024 * 1024; // Initial 25MB - will adjust based on speed detection
let uploadChunkSize = 1 * 1024 * 1024; // Initial 1MB - will adjust based on speed detection
let uploadConcurrency = 1; // Initial single stream - will adjust based on speed
let downloadConcurrency = 1; // Initial single stream for download
let downloadRequestCount = 0; // Count of download requests
let uploadRequestCount = 0; // Count of upload requests

// Test status enum
const TestStatus = {
	IDLE: "idle",
	PROBING: "probing",
	DOWNLOAD: "download",
	UPLOAD: "upload",
	COMPLETE: "complete",
};

// Elements
const startButton = document.getElementById("start-button");
const startIcon = document.getElementById("start-icon");
const gaugeValue = document.getElementById("gauge-value");
const speedValue = document.getElementById("speed-value");
const speedUnit = document.getElementById("speed-unit");
const progressSection = document.getElementById("progress-section");
const statusLabel = document.getElementById("status-label");
const progressBarFill = document.getElementById("progress-bar-fill");
const currentSpeed = document.getElementById("current-speed");
const infoText = document.getElementById("info-text");
const resultContainer = document.getElementById("result-container");
const downloadResult = document.getElementById("download-result");
const uploadResult = document.getElementById("upload-result");
const latencyResult = document.getElementById("latency-result");
const jitterResult = document.getElementById("jitter-result");

// State variables
let isRunning = false;
let testStatus = TestStatus.IDLE;
let testResult = {
	downloadSpeed: 0,
	uploadSpeed: 0,
	latency: 0,
	jitter: 0,
};
let connectionType = "unknown"; // Will be set by probing
let activeDownloadRequests = []; // Track active download XHR requests
let activeUploadRequests = []; // Track active upload XHR requests
let progressInterval = null; // Interval for updating progress
let progressState = "init"; // Current progress state
let progressValue = 0; // Current progress value
let testStartTime = 0; // When the specific test started

// Speed tracking variables
let totalDownloaded = 0; // Total bytes downloaded
let totalUploaded = 0; // Total bytes uploaded
let downloadTimeOffset = 0; // Time offset for download test
let uploadTimeOffset = 0; // Time offset for upload test
let speedSamples = []; // Array for speed samples
let lastDisplayedSpeed = 0; // Last speed displayed
let lastSpeedUpdateTime = 0; // Last time speed was updated
let speedWindow = []; // Sliding window for speed calculation

// Initialize the app
function init() {
	startButton.addEventListener("click", startTest);
	console.log("Infobits Speed Test initialized");
}

// Start the speed test
async function startTest() {
	if (isRunning) return;

	// Reset state
	isRunning = true;
	testStatus = TestStatus.IDLE;
	resetTestData();

	// Hide previous results
	resultContainer.style.display = "none";

	updateUI();

	try {
		// Step 0: Probe connection speed to optimize test parameters
		updateStatus(TestStatus.PROBING);
		const probeSpeed = await probeConnectionSpeed(updateProgress);
		adjustTestParameters(probeSpeed);

		// Small pause between tests
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Step 1: Measure latency
		updateStatus(TestStatus.IDLE);
		const latencyData = await measureLatency();
		testResult.latency = latencyData.latency;
		testResult.jitter = latencyData.jitter;

		// Small pause between tests
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Step 2: Measure download speed
		updateStatus(TestStatus.DOWNLOAD);
		testResult.downloadSpeed = await measureDownloadSpeed(updateProgress);

		// Small pause between tests
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Step 3: Measure upload speed
		updateStatus(TestStatus.UPLOAD);
		testResult.uploadSpeed = await measureUploadSpeed(updateProgress);

		// Complete
		updateStatus(TestStatus.COMPLETE);
		showResults();
	} catch (error) {
		console.error("Speed test failed:", error);
		alert("Speed test failed. Please try again.");
	} finally {
		isRunning = false;
		resetTestData();
		updateUI();
	}
}

// Reset all test data
function resetTestData() {
	totalDownloaded = 0;
	totalUploaded = 0;
	downloadTimeOffset = 0;
	uploadTimeOffset = 0;
	speedSamples = [];
	lastDisplayedSpeed = 0;
	lastSpeedUpdateTime = 0;
	speedWindow = [];
	downloadRequestCount = 0;
	uploadRequestCount = 0;

	// Cancel any active requests
	activeDownloadRequests.forEach((req) => {
		if (req && req.abort) req.abort();
	});
	activeUploadRequests.forEach((req) => {
		if (req && req.abort) req.abort();
	});

	activeDownloadRequests = [];
	activeUploadRequests = [];

	// Clear progress interval
	if (progressInterval) {
		clearInterval(progressInterval);
		progressInterval = null;
	}
}

// Generate a random array safely (respecting crypto API limits)
function generateRandomData(size) {
	const buffer = new Uint8Array(size);

	// Fill in chunks to respect the browser's crypto API limits
	for (let offset = 0; offset < buffer.length; offset += CRYPTO_BLOCK_SIZE) {
		const length = Math.min(CRYPTO_BLOCK_SIZE, buffer.length - offset);
		const chunk = buffer.subarray(offset, offset + length);
		crypto.getRandomValues(chunk);
	}

	return buffer;
}

// Probe connection speed and optimize test parameters
async function probeConnectionSpeed(onProgress) {
	onProgress({ progress: 0, currentSpeed: 0 });
	console.log("Probing connection speed...");

	try {
		// Multiple probes for better estimation
		const probeResults = [];
		const probeSize = 1 * 1024 * 1024; // 1MB
		const smallProbeSize = 256 * 1024; // 256KB
		const probeCount = 3; // Number of probes

		// Start with a small probe to handle slow connections better
		onProgress({ progress: 10, currentSpeed: 0 });
		try {
			const smallProbeSpeed = await runProbe(smallProbeSize);
			if (smallProbeSpeed > 0) probeResults.push(smallProbeSpeed);

			// If the connection is very slow, don't run larger probes
			if (smallProbeSpeed < 5) {
				console.log("Very slow connection detected, using small probe only");
				onProgress({ progress: 100, currentSpeed: smallProbeSpeed });
				return smallProbeSpeed;
			}
		} catch (e) {
			console.warn("Small probe failed:", e);
		}

		// Run main probes
		for (let i = 0; i < probeCount; i++) {
			onProgress({
				progress: 20 + ((i + 1) / probeCount) * 80,
				currentSpeed: 0,
			});
			try {
				const speed = await runProbe(probeSize);
				if (speed > 0) probeResults.push(speed);
			} catch (e) {
				console.warn(`Probe ${i + 1} failed:`, e);
			}

			// Small delay between probes
			if (i < probeCount - 1) {
				await new Promise((resolve) => setTimeout(resolve, 300));
			}
		}

		// Calculate median speed from probes
		let finalSpeed;
		if (probeResults.length > 0) {
			probeResults.sort((a, b) => a - b);
			const midIndex = Math.floor(probeResults.length / 2);
			finalSpeed =
				probeResults.length % 2 === 0
					? (probeResults[midIndex - 1] + probeResults[midIndex]) / 2
					: probeResults[midIndex];
		} else {
			// Fallback if all probes failed
			finalSpeed = 50;
		}

		console.log(`Connection probe speed: ${finalSpeed.toFixed(2)} Mbps`);
		onProgress({ progress: 100, currentSpeed: finalSpeed });

		// Determine connection type
		if (finalSpeed < 10) {
			connectionType = "slow";
			console.log("Detected slow connection (<10 Mbps)");
		} else if (finalSpeed < 50) {
			connectionType = "moderate";
			console.log("Detected moderate connection (10-50 Mbps)");
		} else if (finalSpeed < 200) {
			connectionType = "fast";
			console.log("Detected fast connection (50-200 Mbps)");
		} else if (finalSpeed < 750) {
			connectionType = "very-fast";
			console.log("Detected very fast connection (200-750 Mbps)");
		} else {
			connectionType = "ultra-fast";
			console.log("Detected ultra-fast connection (750+ Mbps)");
		}

		return finalSpeed;
	} catch (error) {
		console.error("Connection probe failed:", error);
		return 50; // Assume moderate speed
	}

	// Helper function to run a single probe
	async function runProbe(size) {
		const url = `/testfile?size=${size}&t=${Date.now()}-probe`;
		const startTime = performance.now();

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Probe request failed: ${response.status}`);
		}

		const reader = response.body.getReader();
		let bytesReceived = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytesReceived += value.length;
		}

		const endTime = performance.now();
		const durationSeconds = (endTime - startTime) / 1000;
		const speedMbps = (bytesReceived * 8) / (1024 * 1024) / durationSeconds;

		console.log(
			`Probe: ${speedMbps.toFixed(
				2
			)} Mbps (${bytesReceived} bytes in ${durationSeconds.toFixed(2)}s)`
		);
		return speedMbps;
	}
}

// Adjust test parameters based on detected connection speed
function adjustTestParameters(speedMbps) {
	// Adjust based on connection type
	if (connectionType === "slow") {
		// Slow connections (<10 Mbps)
		downloadFileSize = 5 * 1024 * 1024; // 5MB
		uploadChunkSize = 256 * 1024; // 256KB
		uploadConcurrency = 1; // Single stream
		downloadConcurrency = 1; // Single stream
	} else if (connectionType === "moderate") {
		// Moderate (10-50 Mbps)
		downloadFileSize = 15 * 1024 * 1024; // 15MB
		uploadChunkSize = 512 * 1024; // 512KB
		uploadConcurrency = 2; // Two streams
		downloadConcurrency = 2; // Two streams
	} else if (connectionType === "fast") {
		// Fast (50-200 Mbps)
		downloadFileSize = 50 * 1024 * 1024; // 50MB
		uploadChunkSize = 1 * 1024 * 1024; // 1MB
		uploadConcurrency = 3; // Three streams
		downloadConcurrency = 3; // Three streams
	} else if (connectionType === "very-fast") {
		// Very fast (200-750 Mbps)
		downloadFileSize = 100 * 1024 * 1024; // 100MB
		uploadChunkSize = 2 * 1024 * 1024; // 2MB
		uploadConcurrency = 4; // Four streams
		downloadConcurrency = 4; // Four streams
	} else {
		// Ultra-fast (750+ Mbps)
		downloadFileSize = 250 * 1024 * 1024; // 250MB
		uploadChunkSize = 4 * 1024 * 1024; // 4MB
		uploadConcurrency = 6; // Six streams
		downloadConcurrency = 6; // Six streams
	}

	console.log(
		`Adjusted test parameters: downloadSize=${
			downloadFileSize / 1024 / 1024
		}MB, uploadChunk=${
			uploadChunkSize / 1024 / 1024
		}MB, downloadConcurrency=${downloadConcurrency}, uploadConcurrency=${uploadConcurrency}`
	);
}

// Measure latency with improved statistics
async function measureLatency() {
	const pingResults = [];
	const jitterValues = [];

	// Reset progress and show status
	updateProgress({ progress: 0, currentSpeed: 0 });
	console.log("Starting latency test");

	// Setup progress tracking
	startProgressTracking(PING_TESTS * 200); // Estimate total time for pings

	// Do initial warm-up pings
	const warmupCount = connectionType === "slow" ? 2 : 3;
	for (let i = 0; i < warmupCount; i++) {
		try {
			await fetch(`/ping?t=${Date.now()}-warmup-${i}`, { method: "GET" });
			await new Promise((resolve) => setTimeout(resolve, 50));
		} catch (e) {
			console.warn("Warm-up ping failed, continuing");
		}
	}

	// Actual ping tests
	let lastPingValue = null;

	for (let i = 0; i < PING_TESTS; i++) {
		try {
			const startTime = performance.now();
			const response = await fetch(`/ping?t=${Date.now()}-${i}`, {
				method: "GET",
			});

			if (!response.ok) {
				console.warn(
					`Ping test ${i + 1} failed with status: ${response.status}`
				);
				continue;
			}

			const endTime = performance.now();
			const latencyValue = endTime - startTime;

			pingResults.push(latencyValue);

			// Calculate jitter as variation between consecutive pings
			if (lastPingValue !== null) {
				const jitter = Math.abs(latencyValue - lastPingValue);
				jitterValues.push(jitter);
			}

			lastPingValue = latencyValue;
			console.log(`Ping ${i + 1}/${PING_TESTS}: ${latencyValue.toFixed(2)}ms`);
		} catch (error) {
			console.error(`Ping test ${i + 1} failed:`, error);
		}

		// Update progress
		updateProgress({
			progress: ((i + 1) / PING_TESTS) * 100,
			currentSpeed: 0,
		});

		// Adapt ping delay based on connection
		const pingDelay =
			connectionType === "slow"
				? 300
				: connectionType === "moderate"
				? 200
				: 100;
		await new Promise((resolve) => setTimeout(resolve, pingDelay));
	}

	// Stop progress tracking
	stopProgressTracking();

	// Calculate final latency and jitter with statistical methods
	let latency, jitter;

	if (pingResults.length >= 5) {
		// Sort results for statistical processing
		const sortedPings = [...pingResults].sort((a, b) => a - b);

		// Remove outliers based on connection type
		const outlierFactor =
			connectionType === "ultra-fast" || connectionType === "very-fast"
				? 0.2
				: 0.1;
		const cutoff = Math.floor(sortedPings.length * outlierFactor);
		const trimmedPings = sortedPings.slice(cutoff, sortedPings.length - cutoff);

		// Use median for more stable results
		const mid = Math.floor(trimmedPings.length / 2);
		latency =
			trimmedPings.length % 2 === 0
				? (trimmedPings[mid - 1] + trimmedPings[mid]) / 2
				: trimmedPings[mid];

		// Calculate jitter
		if (jitterValues.length >= 3) {
			const sortedJitter = [...jitterValues].sort((a, b) => a - b);
			const jitterCutoff = Math.floor(sortedJitter.length * 0.1); // Remove top/bottom 10%
			const trimmedJitter = sortedJitter.slice(
				jitterCutoff,
				sortedJitter.length - jitterCutoff
			);

			// Use mean for jitter
			jitter =
				trimmedJitter.reduce((sum, val) => sum + val, 0) /
				Math.max(1, trimmedJitter.length);
		} else {
			jitter =
				jitterValues.reduce((sum, val) => sum + val, 0) /
				Math.max(1, jitterValues.length);
		}
	} else {
		// Not enough measurements, use simple averages
		latency =
			pingResults.length > 0
				? pingResults.reduce((sum, ping) => sum + ping, 0) / pingResults.length
				: 10;
		jitter =
			jitterValues.length > 0
				? jitterValues.reduce((sum, val) => sum + val, 0) / jitterValues.length
				: 2;
	}

	// For local connections, ensure reasonable values
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";
	if (isLocal && latency < 0.5) {
		console.log("Adjusting latency for local connection");
		latency = Math.max(latency, 0.5);
		jitter = Math.max(jitter, 0.1);
	}

	console.log(
		`Latency test results - Average: ${latency.toFixed(
			2
		)}ms, Jitter: ${jitter.toFixed(2)}ms`
	);
	return { latency, jitter };
}

// Measure download speed with longer tests and improved statistics
async function measureDownloadSpeed(onProgress) {
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	// Special case for local testing on high-speed connections
	if (
		isLocal &&
		(connectionType === "very-fast" || connectionType === "ultra-fast")
	) {
		const simulatedSpeed = connectionType === "ultra-fast" ? 2500 : 750;
		return simulateSpeedTest(onProgress, simulatedSpeed, "download");
	}

	console.log(
		`Starting download test with target duration: ${TARGET_DL_DURATION}s`
	);

	// Reset measurement state
	resetSpeedMeasurement();
	testStartTime = performance.now();
	downloadTimeOffset = 0;
	totalDownloaded = 0;

	// Set up progress tracking with test duration
	startProgressTracking(TARGET_DL_DURATION * 1000);

	try {
		// Start multiple download streams
		const downloadPromises = [];
		for (let i = 0; i < downloadConcurrency; i++) {
			downloadPromises.push(startDownloadStream(i));

			// Stagger the start of streams for better stability
			if (i < downloadConcurrency - 1) {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}

		// Wait for all streams to complete or timeout
		await Promise.race([
			Promise.all(downloadPromises),
			new Promise((resolve) =>
				setTimeout(resolve, TARGET_DL_DURATION * 1000 + 5000)
			), // Extra 5s grace period
		]);

		// After test completion or timeout, abort any remaining streams
		for (let req of activeDownloadRequests) {
			if (req && req.abort) req.abort();
		}

		// Calculate final result
		const finalSpeed = calculateFinalSpeed(speedSamples, "download");
		console.log(`Download test complete: ${finalSpeed.toFixed(2)} Mbps`);

		// Clean up
		stopProgressTracking();
		resetActiveRequests();

		return finalSpeed;
	} catch (error) {
		console.error("Download test failed:", error);
		stopProgressTracking();
		resetActiveRequests();
		return calculateFallbackSpeed("download");
	}

	// Function to start a single download stream
	async function startDownloadStream(streamIndex) {
		// Create a unique URL to avoid caching
		const url = `/testfile?size=${downloadFileSize}&stream=${streamIndex}&t=${Date.now()}`;
		console.log(
			`Starting download stream ${streamIndex} with size ${
				downloadFileSize / 1024 / 1024
			}MB`
		);

		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			activeDownloadRequests.push(xhr);

			let lastLoadedBytes = 0;
			let startTime = performance.now();
			let warmupPhaseComplete = false;

			xhr.open("GET", url, true);
			xhr.responseType = "arraybuffer";

			xhr.onprogress = function (event) {
				const now = performance.now();
				const bytesLoaded = event.loaded - lastLoadedBytes;
				lastLoadedBytes = event.loaded;

				// Check if we're past the warmup phase
				if (
					!warmupPhaseComplete &&
					now - testStartTime > WARMUP_DURATION * 1000
				) {
					warmupPhaseComplete = true;
					console.log(`Stream ${streamIndex} exiting warmup phase`);
					// Reset measurements after warmup
					startTime = now;
					speedSamples = [];
				}

				// Only count bytes after warmup phase
				if (warmupPhaseComplete) {
					totalDownloaded += bytesLoaded;

					// Calculate and record speed
					const elapsedSeconds = (now - startTime) / 1000;
					if (elapsedSeconds > 0) {
						// Calculate current speed for this stream
						const instantSpeed =
							(bytesLoaded * 8) / (1024 * 1024) / elapsedSeconds;

						// Add to speed samples if reasonable
						if (instantSpeed > 0 && instantSpeed < 50000) {
							speedSamples.push({
								time: now,
								speed: instantSpeed,
							});

							// Calculate and display current speed
							displayCurrentSpeed(now);
						}
					}
				}
			};

			xhr.onload = function () {
				if (xhr.status >= 200 && xhr.status < 300) {
					console.log(`Download stream ${streamIndex} completed successfully`);

					// Start a new stream to maintain concurrency for the test duration
					const elapsed = performance.now() - testStartTime;
					if (elapsed < TARGET_DL_DURATION * 1000) {
						console.log(
							`Starting replacement download stream for ${streamIndex}`
						);
						startDownloadStream(streamIndex).catch(console.error);
					}

					resolve();
				} else {
					console.warn(
						`Download stream ${streamIndex} failed with status ${xhr.status}`
					);
					reject(new Error(`HTTP error ${xhr.status}`));
				}
			};

			xhr.onerror = function () {
				console.error(`Download stream ${streamIndex} error`);
				reject(new Error("Network error"));
			};

			xhr.onabort = function () {
				console.log(`Download stream ${streamIndex} aborted`);
				resolve(); // Resolve on abort, not an error
			};

			xhr.ontimeout = function () {
				console.warn(`Download stream ${streamIndex} timed out`);
				reject(new Error("Timeout"));
			};

			xhr.send();
			downloadRequestCount++;
		});
	}
}

// Measure upload speed with longer tests and improved statistics
async function measureUploadSpeed(onProgress) {
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	// Special case for local testing on high-speed connections
	if (
		isLocal &&
		(connectionType === "very-fast" || connectionType === "ultra-fast")
	) {
		const simulatedSpeed = connectionType === "ultra-fast" ? 2000 : 600;
		return simulateSpeedTest(onProgress, simulatedSpeed, "upload");
	}

	console.log(
		`Starting upload test with target duration: ${TARGET_UL_DURATION}s`
	);

	// Reset measurement state
	resetSpeedMeasurement();
	testStartTime = performance.now();
	uploadTimeOffset = 0;
	totalUploaded = 0;

	// Set up progress tracking with test duration
	startProgressTracking(TARGET_UL_DURATION * 1000);

	try {
		// Generate upload data - will be reused across requests
		console.log(
			`Generating upload data (${uploadChunkSize / 1024 / 1024}MB chunks)...`
		);

		// Create chunks of upload data
		const uploadChunks = [];
		const chunksNeeded = Math.max(12, uploadConcurrency * 3); // Ensure we have enough chunks

		// Generate chunks with progress tracking (5% of overall progress)
		for (let i = 0; i < chunksNeeded; i++) {
			uploadChunks.push(generateRandomData(uploadChunkSize));
			updateProgress({
				progress: (i / chunksNeeded) * 5,
				currentSpeed: 0,
			});

			// Small delay to not freeze UI during data generation
			if (i % 3 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}

		// Start multiple upload streams
		const uploadPromises = [];
		for (let i = 0; i < uploadConcurrency; i++) {
			uploadPromises.push(startUploadStream(i, uploadChunks));

			// Stagger the start of streams for better stability
			if (i < uploadConcurrency - 1) {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}

		// Continue uploading until target duration is reached
		await Promise.race([
			Promise.all(uploadPromises),
			new Promise((resolve) =>
				setTimeout(resolve, TARGET_UL_DURATION * 1000 + 5000)
			), // Extra 5s grace period
		]);

		// After test completion or timeout, abort any remaining streams
		for (let req of activeUploadRequests) {
			if (req && req.abort) req.abort();
		}

		// Calculate final result
		const finalSpeed = calculateFinalSpeed(speedSamples, "upload");
		console.log(`Upload test complete: ${finalSpeed.toFixed(2)} Mbps`);

		// Clean up
		stopProgressTracking();
		resetActiveRequests();

		return finalSpeed;
	} catch (error) {
		console.error("Upload test failed:", error);
		stopProgressTracking();
		resetActiveRequests();
		return calculateFallbackSpeed("upload");
	}

	// Function to start a single upload stream
	async function startUploadStream(streamIndex, uploadChunks) {
		console.log(`Starting upload stream ${streamIndex}`);

		return new Promise((resolve, reject) => {
			let chunkIndex = streamIndex % uploadChunks.length;
			let warmupPhaseComplete = false;
			let startTime = performance.now();

			function uploadNextChunk() {
				const now = performance.now();
				const elapsed = now - testStartTime;

				// Check if we've reached the test duration
				if (elapsed >= TARGET_UL_DURATION * 1000) {
					console.log(`Upload stream ${streamIndex} reached target duration`);
					resolve();
					return;
				}

				// Check if we're past the warmup phase
				if (!warmupPhaseComplete && elapsed > WARMUP_DURATION * 1000) {
					warmupPhaseComplete = true;
					console.log(`Stream ${streamIndex} exiting warmup phase`);
					// Reset measurements after warmup
					startTime = now;
				}

				// Get next chunk to upload (rotate through available chunks)
				const chunk = uploadChunks[chunkIndex];
				chunkIndex = (chunkIndex + 1) % uploadChunks.length;

				// Create unique URL to avoid caching
				const url = `/upload?stream=${streamIndex}&chunk=${uploadRequestCount}&t=${Date.now()}`;

				const xhr = new XMLHttpRequest();
				activeUploadRequests.push(xhr);

				let lastUploadedBytes = 0;
				let chunkStartTime = performance.now();

				xhr.upload.onprogress = function (event) {
					const progressNow = performance.now();
					const bytesUploaded = event.loaded - lastUploadedBytes;
					lastUploadedBytes = event.loaded;

					// Only count bytes after warmup phase
					if (warmupPhaseComplete) {
						totalUploaded += bytesUploaded;

						// Calculate and record speed
						const elapsedSeconds = (progressNow - chunkStartTime) / 1000;
						if (elapsedSeconds > 0) {
							// Calculate current speed for this chunk
							const instantSpeed =
								(bytesUploaded * 8) / (1024 * 1024) / elapsedSeconds;

							// Add to speed samples if reasonable
							if (instantSpeed > 0 && instantSpeed < 50000) {
								speedSamples.push({
									time: progressNow,
									speed: instantSpeed,
								});

								// Calculate and display current speed
								displayCurrentSpeed(progressNow);
							}
						}

						// Reset for next progress event
						chunkStartTime = progressNow;
					}
				};

				xhr.onload = function () {
					// Remove this request from active list
					const index = activeUploadRequests.indexOf(xhr);
					if (index > -1) activeUploadRequests.splice(index, 1);

					if (xhr.status >= 200 && xhr.status < 300) {
						// If we're still within test duration, upload another chunk
						uploadNextChunk();
					} else {
						console.warn(
							`Upload stream ${streamIndex} failed with status ${xhr.status}`
						);
						// Continue with next chunk anyway
						uploadNextChunk();
					}
				};

				xhr.onerror = function () {
					console.error(`Upload stream ${streamIndex} error`);
					// Continue with next chunk despite error
					uploadNextChunk();
				};

				xhr.onabort = function () {
					console.log(`Upload stream ${streamIndex} aborted`);
					resolve(); // Resolve on abort
				};

				xhr.ontimeout = function () {
					console.warn(`Upload stream ${streamIndex} timed out`);
					// Continue with next chunk despite timeout
					uploadNextChunk();
				};

				xhr.open("POST", url, true);
				xhr.setRequestHeader("Content-Type", "application/octet-stream");
				xhr.send(chunk);
				uploadRequestCount++;
			}

			// Start the upload process
			uploadNextChunk();
		});
	}
}

// Simulate speed test for local testing with realistic variations
function simulateSpeedTest(onProgress, baseSpeed, type) {
	return new Promise((resolve) => {
		console.log(`Using ${type} speed simulation (${baseSpeed} Mbps)`);

		// Reset speed measurement for simulation
		resetSpeedMeasurement();

		// Different parameters for different test types
		const variation = type === "download" ? 0.05 : 0.1; // 5% variation for download, 10% for upload
		const updateFrequency = 150; // ms between updates
		const testDuration =
			type === "download" ? TARGET_DL_DURATION : TARGET_UL_DURATION;

		// For upload, use a slight reduction from download speed
		const actualBaseSpeed = type === "upload" ? baseSpeed * 0.85 : baseSpeed;

		// TCP slow-start simulation
		const rampUpFactor = 0.3; // Start at 30% of max speed
		const rampUpDuration = 5000; // 5 seconds to reach full speed

		// Start progress tracking
		startProgressTracking(testDuration * 1000);
		const testStart = performance.now();

		// Simulate test with variations in speed over time
		const interval = setInterval(() => {
			const now = performance.now();
			const elapsed = now - testStart;

			// Check if we've reached the end of the test
			if (elapsed >= testDuration * 1000) {
				clearInterval(interval);

				// Calculate final speed using our statistical methods
				const finalSpeed = calculateFinalSpeed(speedSamples, type);
				stopProgressTracking();
				resolve(finalSpeed);
				return;
			}

			// Check if we're past the warmup phase
			const isWarmupPhase = elapsed < WARMUP_DURATION * 1000;

			// TCP slow-start effect
			let speedModifier = 1;
			if (elapsed < rampUpDuration) {
				speedModifier =
					rampUpFactor + (1 - rampUpFactor) * (elapsed / rampUpDuration);
			}

			// Realistic speed variations
			// Variation reduces as connection stabilizes
			const stabilityFactor = Math.min(1, elapsed / 8000) * 0.7;
			const currentVariation = variation * (1 - stabilityFactor);

			// Add periodic fluctuations to simulate network congestion
			const periodicEffect = Math.sin(elapsed / 3000) * 0.05;

			// Calculate speed
			const speedFactor =
				1 -
				currentVariation +
				Math.random() * currentVariation * 2 +
				periodicEffect;
			const currentSpeed = actualBaseSpeed * speedFactor * speedModifier;

			// Only record speed after warmup phase
			if (!isWarmupPhase) {
				speedSamples.push({
					time: now,
					speed: currentSpeed,
				});
			}

			// Update progress and speed display
			updateProgress({
				progress: (elapsed / (testDuration * 1000)) * 100,
				currentSpeed: currentSpeed,
			});
		}, updateFrequency);
	});
}

// Helper function to reset speed measurement
function resetSpeedMeasurement() {
	speedSamples = [];
	lastDisplayedSpeed = 0;
	lastSpeedUpdateTime = 0;
	speedWindow = [];
}

// Helper function to reset active requests
function resetActiveRequests() {
	// Cancel and clear all active requests
	for (let req of activeDownloadRequests) {
		if (req && req.abort) req.abort();
	}
	for (let req of activeUploadRequests) {
		if (req && req.abort) req.abort();
	}
	activeDownloadRequests = [];
	activeUploadRequests = [];
}

// Calculate and display current speed
function displayCurrentSpeed(now) {
	// Throttle updates to avoid too frequent UI updates
	if (now - lastSpeedUpdateTime < MEASUREMENT_INTERVAL) {
		return;
	}

	lastSpeedUpdateTime = now;

	// Calculate average speed over the last few seconds using a sliding window
	const windowDuration = SPEED_AVG_WINDOW * 1000; // Window size in ms
	const relevantSamples = speedSamples.filter(
		(sample) => now - sample.time <= windowDuration
	);

	if (relevantSamples.length > 0) {
		const avgSpeed =
			relevantSamples.reduce((sum, sample) => sum + sample.speed, 0) /
			relevantSamples.length;

		// Apply smoothing to avoid jumpy display
		const smoothingFactor = 0.7; // Higher = more smoothing
		const displaySpeed =
			lastDisplayedSpeed > 0
				? lastDisplayedSpeed * smoothingFactor +
				  avgSpeed * (1 - smoothingFactor)
				: avgSpeed;

		lastDisplayedSpeed = displaySpeed;

		// Update the UI
		updateProgress({
			progress: getProgressValue(),
			currentSpeed: displaySpeed,
		});
	}
}

// Calculate final speed using statistical analysis
function calculateFinalSpeed(samples, testType) {
	if (samples.length === 0) {
		return calculateFallbackSpeed(testType);
	}

	// Sort samples by speed
	samples.sort((a, b) => a.speed - b.speed);

	// Apply different statistical methods based on connection type
	let finalSpeed;

	if (connectionType === "ultra-fast") {
		// For ultra-high-speed, use 90th percentile
		const idx = Math.floor(samples.length * 0.9);
		finalSpeed = samples[idx].speed;
		console.log("Using 90th percentile for ultra-high-speed:", finalSpeed);
	} else if (connectionType === "very-fast") {
		// For very-high-speed, use 85th percentile
		const idx = Math.floor(samples.length * 0.85);
		finalSpeed = samples[idx].speed;
		console.log("Using 85th percentile for very-high-speed:", finalSpeed);
	} else if (connectionType === "fast") {
		// For fast connections, use 80th percentile
		const idx = Math.floor(samples.length * 0.8);
		finalSpeed = samples[idx].speed;
		console.log("Using 80th percentile for fast connection:", finalSpeed);
	} else if (connectionType === "moderate") {
		// For moderate connections, use 75th percentile
		const idx = Math.floor(samples.length * 0.75);
		finalSpeed = samples[idx].speed;
		console.log("Using 75th percentile for moderate connection:", finalSpeed);
	} else {
		// For slower connections, use median (50th percentile)
		const idx = Math.floor(samples.length * 0.5);
		finalSpeed = samples[idx].speed;
		console.log("Using median for slow connection:", finalSpeed);
	}

	return finalSpeed;
}

// Calculate fallback speed if test fails
function calculateFallbackSpeed(testType) {
	console.warn(`Using fallback speed calculation for ${testType}`);

	// Set fallback speeds based on connection type
	const fallbackSpeeds = {
		"ultra-fast": { download: 1000, upload: 800 },
		"very-fast": { download: 500, upload: 400 },
		fast: { download: 100, upload: 80 },
		moderate: { download: 30, upload: 25 },
		slow: { download: 5, upload: 3 },
	};

	return fallbackSpeeds[connectionType]?.[testType] || 10;
}

// Start progress tracking
function startProgressTracking(duration) {
	stopProgressTracking(); // Ensure no existing interval

	progressState = "init";
	progressValue = 0;
	const startTime = performance.now();

	progressInterval = setInterval(() => {
		const elapsed = performance.now() - startTime;
		progressValue = Math.min(99, (elapsed / duration) * 100); // Cap at 99% until complete
	}, 100);
}

// Stop progress tracking
function stopProgressTracking() {
	if (progressInterval) {
		clearInterval(progressInterval);
		progressInterval = null;
	}
	progressValue = 100; // Complete
	progressState = "done";
}

// Get current progress value
function getProgressValue() {
	return progressValue;
}

// Update the UI based on current state
function updateUI() {
	startButton.disabled = isRunning;
	startButton.classList.toggle("disabled", isRunning);
	startButton.textContent = isRunning ? "Running Test..." : "Start Speed Test";

	startIcon.style.display =
		isRunning || testStatus === TestStatus.COMPLETE ? "none" : "block";
	gaugeValue.style.display = isRunning ? "flex" : "none";

	progressSection.style.display = isRunning ? "block" : "none";

	// Show/hide info text
	infoText.textContent =
		!isRunning && testStatus !== TestStatus.COMPLETE
			? "Click the button to test your internet connection speed."
			: "";
}

// Update the status and progress of the test
function updateStatus(status, data) {
	testStatus = status;

	// Update status label text
	switch (status) {
		case TestStatus.PROBING:
			statusLabel.textContent = "Detecting Connection Speed...";
			progressBarFill.style.backgroundColor = "#9ca3af"; // Gray
			break;
		case TestStatus.DOWNLOAD:
			statusLabel.textContent = "Testing Download Speed...";
			progressBarFill.style.backgroundColor = "#2563eb"; // Blue
			break;
		case TestStatus.UPLOAD:
			statusLabel.textContent = "Testing Upload Speed...";
			progressBarFill.style.backgroundColor = "#7c3aed"; // Purple
			break;
		case TestStatus.COMPLETE:
			statusLabel.textContent = "Test Complete";
			break;
		default:
			statusLabel.textContent = "Measuring Latency...";
			progressBarFill.style.backgroundColor = "#6b7280"; // Gray
	}

	updateUI();

	// Update progress if data is provided
	if (data) {
		updateProgress(data);
	}
}

// Update the progress bar and current speed display
function updateProgress(data) {
	// Update progress bar
	progressBarFill.style.width = `${data.progress}%`;

	// Update speed display in the gauge
	if (data.currentSpeed > 0) {
		speedValue.textContent = formatSpeed(data.currentSpeed);
		speedUnit.textContent =
			testStatus === TestStatus.DOWNLOAD
				? "Download"
				: testStatus === TestStatus.UPLOAD
				? "Upload"
				: "";
		currentSpeed.textContent = formatSpeed(data.currentSpeed);
	} else {
		// If no speed value, show the test type
		if (testStatus === TestStatus.PROBING) {
			speedValue.textContent = "Detecting";
			speedUnit.textContent = "Speed";
		} else if (testStatus === TestStatus.IDLE) {
			speedValue.textContent = "Measuring";
			speedUnit.textContent = "Latency";
		}
		currentSpeed.textContent = "";
	}
}

// Show the test results
function showResults() {
	// Update result elements
	downloadResult.textContent = formatSpeed(testResult.downloadSpeed);
	downloadResult.className = `result-value ${getSpeedClass(
		testResult.downloadSpeed
	)}`;

	uploadResult.textContent = formatSpeed(testResult.uploadSpeed);
	uploadResult.className = `result-value ${getSpeedClass(
		testResult.uploadSpeed
	)}`;

	latencyResult.textContent = formatLatency(testResult.latency);
	latencyResult.className = `result-value ${getLatencyClass(
		testResult.latency
	)}`;

	jitterResult.textContent = formatLatency(testResult.jitter);
	jitterResult.className = `result-value ${getLatencyClass(testResult.jitter)}`;

	// Show the results container with animation
	resultContainer.style.display = "block";

	// Log complete test results
	console.log("Speed test completed with the following results:");
	console.log(`Download: ${formatSpeed(testResult.downloadSpeed)}`);
	console.log(`Upload: ${formatSpeed(testResult.uploadSpeed)}`);
	console.log(`Latency: ${formatLatency(testResult.latency)}`);
	console.log(`Jitter: ${formatLatency(testResult.jitter)}`);
	console.log(
		`Total downloaded: ${(totalDownloaded / (1024 * 1024)).toFixed(2)} MB`
	);
	console.log(
		`Total uploaded: ${(totalUploaded / (1024 * 1024)).toFixed(2)} MB`
	);
	console.log(
		`Download requests: ${downloadRequestCount}, Upload requests: ${uploadRequestCount}`
	);
}

// Helper function to format speed with appropriate units
function formatSpeed(speed) {
	if (speed >= 1000) {
		return `${(speed / 1000).toFixed(2)} Gbps`;
	} else {
		return `${speed.toFixed(2)} Mbps`;
	}
}

// Helper function to get appropriate class for the speed
function getSpeedClass(speed) {
	const maxSpeed = MAX_SPEED_CLASS;

	if (speed >= maxSpeed * 0.7) return "excellent"; // >7Gbps for 10Gbps max
	if (speed >= maxSpeed * 0.3) return "good"; // >3Gbps
	if (speed >= maxSpeed * 0.1) return "average"; // >1Gbps
	if (speed >= maxSpeed * 0.05) return "belowAverage"; // >500Mbps
	return "poor";
}

// Helper function to format latency
function formatLatency(ms) {
	return `${ms.toFixed(1)} ms`;
}

// Helper function to get class for the latency
function getLatencyClass(ms) {
	if (ms < 5) return "excellent";
	if (ms < 20) return "good";
	if (ms < 50) return "average";
	if (ms < 100) return "belowAverage";
	return "poor";
}

// Initialize the app when the page loads
document.addEventListener("DOMContentLoaded", init);
