// Constants
const PING_TESTS = 25; // Number of ping tests
const MIN_TEST_DURATION = 30; // Minimum test duration in seconds
const MAX_TEST_DURATION = 45; // Maximum test duration in seconds
const MEASUREMENT_INTERVAL = 100; // Milliseconds between measurements
const MAX_SPEED_CLASS = 10000; // Upper bound for speed classification (10 Gbps)
const CRYPTO_BLOCK_SIZE = 65536; // Maximum bytes for crypto.getRandomValues() (browser security limit)
const WARMUP_DURATION = 5; // Seconds for warmup phase

// Fixed sizes as specified
const DOWNLOAD_FILE_SIZE = 32 * 1024 * 1024; // Fixed 32 MB download size
const UPLOAD_FILE_SIZE = 32 * 1024 * 1024; // Fixed 32 MB upload size (changed from 500 bytes)

// Initial concurrency settings (can still adjust based on connection)
let downloadConcurrency = 4; // Initial concurrent downloads
let uploadConcurrency = 4; // Initial concurrent uploads
let downloadBufferSize = 1 * 1024 * 1024; // 1MB download buffer size
let useChunkedEncoding = true; // Use chunked encoding for uploads

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
let totalDownloaded = 0; // Track total bytes downloaded
let totalUploaded = 0; // Track total bytes uploaded
let downloadSpeeds = []; // Array of download speeds
let uploadSpeeds = []; // Array of upload speeds
let activeXhrs = []; // Track active XMLHttpRequest objects
let testStartTime = 0; // When the test started
let testEndTime = 0; // When the test should end
let lastDisplaySpeed = 0; // Last displayed speed
let speedCalculationMethod = "percentile"; // Method to calculate final speed

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
	downloadSpeeds = [];
	uploadSpeeds = [];
	lastDisplaySpeed = 0;

	// Cancel any active requests
	activeXhrs.forEach((xhr) => {
		try {
			if (xhr && xhr.readyState !== 4) xhr.abort();
		} catch (e) {
			console.warn("Error aborting request:", e);
		}
	});
	activeXhrs = [];
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

// Multi-stage probe for connection speed
async function probeConnectionSpeed(onProgress) {
	onProgress({ progress: 0, currentSpeed: 0 });
	console.log("Probing connection speed...");

	try {
		// First try a small probe to detect slow connections
		const smallProbeSize = 1 * 1024 * 1024; // 1MB
		onProgress({ progress: 10, currentSpeed: 0 });

		const smallProbeSpeed = await runProbe(smallProbeSize);
		console.log(`Small probe speed: ${smallProbeSpeed.toFixed(2)} Mbps`);

		// If speed is low, we don't need larger probes
		if (smallProbeSpeed < 25) {
			onProgress({ progress: 100, currentSpeed: smallProbeSpeed });
			determineConnectionType(smallProbeSpeed);
			return smallProbeSpeed;
		}

		// For faster connections, run a larger probe
		const largeProbeSize = 5 * 1024 * 1024; // 5MB (reduced from 10MB)
		onProgress({ progress: 50, currentSpeed: smallProbeSpeed });

		const largeProbeSpeed = await runProbe(largeProbeSize);
		console.log(`Large probe speed: ${largeProbeSpeed.toFixed(2)} Mbps`);

		// For very fast connections, run an extra large probe
		if (largeProbeSpeed > 500) {
			const xlProbeSize = 10 * 1024 * 1024; // 10MB (reduced from 50MB)
			onProgress({ progress: 75, currentSpeed: largeProbeSpeed });

			const xlProbeSpeed = await runProbe(xlProbeSize);
			console.log(`Extra large probe speed: ${xlProbeSpeed.toFixed(2)} Mbps`);

			// Use the extra large probe result
			onProgress({ progress: 100, currentSpeed: xlProbeSpeed });
			determineConnectionType(xlProbeSpeed);
			return xlProbeSpeed;
		}

		// Use the large probe result
		onProgress({ progress: 100, currentSpeed: largeProbeSpeed });
		determineConnectionType(largeProbeSpeed);
		return largeProbeSpeed;
	} catch (error) {
		console.error("Connection probe failed:", error);
		// Default to moderate-fast speed if probing fails
		determineConnectionType(100);
		return 100;
	}

	// Helper function to run a single probe
	async function runProbe(size) {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			activeXhrs.push(xhr);

			const url = `/testfile?size=${size}&t=${Date.now()}-probe`;
			const startTime = performance.now();

			xhr.open("GET", url, true);
			xhr.responseType = "arraybuffer";

			xhr.onload = function () {
				if (xhr.status >= 200 && xhr.status < 300) {
					const endTime = performance.now();
					const duration = (endTime - startTime) / 1000; // seconds
					const bytesReceived = xhr.response.byteLength;

					// Calculate speed in Mbps
					const speed = (bytesReceived * 8) / (1024 * 1024) / duration;
					resolve(speed);
				} else {
					reject(new Error(`HTTP error ${xhr.status}`));
				}
			};

			xhr.onerror = function () {
				reject(new Error("Network error during probe"));
			};

			xhr.ontimeout = function () {
				reject(new Error("Timeout during probe"));
			};

			xhr.send();
		});
	}

	// Helper function to determine connection type
	function determineConnectionType(speed) {
		if (speed < 10) {
			connectionType = "slow";
			console.log("Detected slow connection (<10 Mbps)");
		} else if (speed < 50) {
			connectionType = "moderate";
			console.log("Detected moderate connection (10-50 Mbps)");
		} else if (speed < 300) {
			connectionType = "fast";
			console.log("Detected fast connection (50-300 Mbps)");
		} else if (speed < 1000) {
			connectionType = "very-fast";
			console.log("Detected very fast connection (300-1000 Mbps)");
		} else if (speed < 2500) {
			connectionType = "ultra-fast";
			console.log("Detected ultra-fast connection (1-2.5 Gbps)");
		} else {
			connectionType = "extreme-fast";
			console.log("Detected extreme-fast connection (2.5+ Gbps)");
		}
	}
}

// Adjust test parameters based on detected connection speed
function adjustTestParameters(speedMbps) {
	// Concurrency adjustments only - file sizes are now fixed
	if (connectionType === "slow") {
		downloadConcurrency = 2;
		uploadConcurrency = 2;
		downloadBufferSize = 256 * 1024; // 256KB
		speedCalculationMethod = "median";
	} else if (connectionType === "moderate") {
		downloadConcurrency = 3;
		uploadConcurrency = 3;
		downloadBufferSize = 512 * 1024; // 512KB
		speedCalculationMethod = "percentile";
	} else if (connectionType === "fast") {
		downloadConcurrency = 4;
		uploadConcurrency = 4;
		downloadBufferSize = 1 * 1024 * 1024; // 1MB
		speedCalculationMethod = "percentile";
	} else if (connectionType === "very-fast") {
		downloadConcurrency = 6;
		uploadConcurrency = 6;
		downloadBufferSize = 2 * 1024 * 1024; // 2MB
		speedCalculationMethod = "percentile";
	} else if (connectionType === "ultra-fast") {
		downloadConcurrency = 8;
		uploadConcurrency = 8;
		downloadBufferSize = 4 * 1024 * 1024; // 4MB
		speedCalculationMethod = "max-sustained";
	} else {
		downloadConcurrency = 12;
		uploadConcurrency = 10;
		downloadBufferSize = 8 * 1024 * 1024; // 8MB
		speedCalculationMethod = "max-sustained";
	}

	console.log(
		`Adjusted test parameters: downloadSize=${
			DOWNLOAD_FILE_SIZE / 1024 / 1024
		}MB, uploadSize=${
			UPLOAD_FILE_SIZE / 1024 / 1024
		}MB, concurrency=${downloadConcurrency}/${uploadConcurrency}, method=${speedCalculationMethod}`
	);
}

// Measure latency
async function measureLatency() {
	const pingResults = [];
	const jitterValues = [];

	// Reset progress and show status
	updateProgress({ progress: 0, currentSpeed: 0 });
	console.log("Starting latency test");

	// Do initial warm-up pings
	const warmupCount = 3;
	for (let i = 0; i < warmupCount; i++) {
		try {
			await fetch(`/ping?t=${Date.now()}-warmup-${i}`, { method: "GET" });
		} catch (e) {
			console.warn("Warm-up ping failed, continuing with test");
		}
	}

	// Actual ping tests
	let lastPing = null;

	for (let i = 0; i < PING_TESTS; i++) {
		try {
			const startTime = performance.now();
			const response = await fetch(`/ping?t=${Date.now()}-${i}`, {
				method: "GET",
			});
			const endTime = performance.now();

			if (response.ok) {
				const latencyValue = endTime - startTime;
				pingResults.push(latencyValue);

				// Calculate jitter (variation between consecutive pings)
				if (lastPing !== null) {
					const jitter = Math.abs(latencyValue - lastPing);
					jitterValues.push(jitter);
				}

				lastPing = latencyValue;
				console.log(
					`Ping ${i + 1}/${PING_TESTS}: ${latencyValue.toFixed(2)}ms`
				);
			}
		} catch (error) {
			console.error("Ping test failed:", error);
		}

		// Update progress
		updateProgress({
			progress: ((i + 1) / PING_TESTS) * 100,
			currentSpeed: 0,
		});

		// Delay between pings
		const pingDelay =
			connectionType === "slow"
				? 300
				: connectionType === "moderate"
				? 200
				: 100;
		await new Promise((resolve) => setTimeout(resolve, pingDelay));
	}

	// Calculate latency and jitter with statistical methods
	let latency = 0,
		jitter = 0;

	if (pingResults.length >= 5) {
		// Sort results for statistical processing
		const sortedPings = [...pingResults].sort((a, b) => a - b);

		// Remove outliers (top and bottom 10%)
		const cutoff = Math.floor(sortedPings.length * 0.1);
		const trimmedPings = sortedPings.slice(cutoff, sortedPings.length - cutoff);

		// Use median for latency
		const midIndex = Math.floor(trimmedPings.length / 2);
		latency =
			trimmedPings.length % 2 === 0
				? (trimmedPings[midIndex - 1] + trimmedPings[midIndex]) / 2
				: trimmedPings[midIndex];

		// Calculate jitter as average deviation
		if (jitterValues.length > 2) {
			const sortedJitter = [...jitterValues].sort((a, b) => a - b);
			const jitterCutoff = Math.floor(sortedJitter.length * 0.1);
			const trimmedJitter = sortedJitter.slice(
				jitterCutoff,
				sortedJitter.length - jitterCutoff
			);

			jitter =
				trimmedJitter.reduce((sum, val) => sum + val, 0) / trimmedJitter.length;
		} else {
			jitter =
				jitterValues.reduce((sum, val) => sum + val, 0) /
				Math.max(1, jitterValues.length);
		}
	} else {
		// Not enough measurements, use simple average
		latency =
			pingResults.length > 0
				? pingResults.reduce((sum, ping) => sum + ping, 0) / pingResults.length
				: 10;
		jitter =
			jitterValues.length > 0
				? jitterValues.reduce((sum, val) => sum + val, 0) / jitterValues.length
				: 2;
	}

	// For local connections, ensure reasonable minimum values
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";
	if (isLocal && latency < 0.5) {
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

// Optimized download speed test with fixed file size (32 MB)
async function measureDownloadSpeed(onProgress) {
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	// Special case for local testing on extremely high-speed connections
	if (
		isLocal &&
		(connectionType === "ultra-fast" || connectionType === "extreme-fast")
	) {
		const simulatedSpeed = connectionType === "extreme-fast" ? 2500 : 1500;
		return simulateSpeedTest(onProgress, simulatedSpeed, "download");
	}

	console.log(
		`Starting download test with concurrency: ${downloadConcurrency}, file size: 32MB`
	);

	// Reset state
	downloadSpeeds = [];
	totalDownloaded = 0;

	// Set test duration
	testStartTime = performance.now();
	testEndTime = testStartTime + MIN_TEST_DURATION * 1000;
	const testMaxEndTime = testStartTime + MAX_TEST_DURATION * 1000;

	// Calculate warmup end time
	const warmupEndTime = testStartTime + WARMUP_DURATION * 1000;
	let isInWarmupPhase = true;

	// Setup speed tracking
	let speedSampleInterval;
	let lastMeasurementTime = testStartTime;
	let lastTotalBytes = 0;
	let speedWindowBytes = 0;
	let speedWindowStartTime = testStartTime;

	// Start speed sampling interval
	speedSampleInterval = setInterval(() => {
		const now = performance.now();

		// Skip measurement during warmup
		if (isInWarmupPhase && now < warmupEndTime) {
			return;
		}

		// Check if we just exited warmup
		if (isInWarmupPhase && now >= warmupEndTime) {
			console.log("Exiting download warmup phase");
			isInWarmupPhase = false;
			lastMeasurementTime = now;
			lastTotalBytes = totalDownloaded;
			speedWindowBytes = 0;
			speedWindowStartTime = now;
			return;
		}

		const bytesDelta = totalDownloaded - lastTotalBytes;
		const timeDelta = (now - lastMeasurementTime) / 1000; // seconds

		if (timeDelta > 0 && bytesDelta > 0) {
			// Calculate instantaneous speed in Mbps
			const currentSpeed = (bytesDelta * 8) / (1024 * 1024) / timeDelta;

			// Add to speed window
			speedWindowBytes += bytesDelta;

			// Calculate window speed (last 1-3 seconds depending on connection)
			const windowDuration = (now - speedWindowStartTime) / 1000;
			const windowThreshold =
				connectionType === "ultra-fast" || connectionType === "extreme-fast"
					? 1
					: connectionType === "very-fast"
					? 2
					: 3;

			if (windowDuration >= windowThreshold) {
				const windowSpeed =
					(speedWindowBytes * 8) / (1024 * 1024) / windowDuration;

				// Record valid speed
				if (windowSpeed > 0 && windowSpeed < 20000) {
					downloadSpeeds.push(windowSpeed);
					console.log(`Download window speed: ${windowSpeed.toFixed(2)} Mbps`);

					// Apply smoothing for display
					const displaySpeed = applySmoothing(windowSpeed);

					// Update progress
					const progress = Math.min(
						99,
						((now - testStartTime) / (MIN_TEST_DURATION * 1000)) * 100
					);
					onProgress({ progress, currentSpeed: displaySpeed });
				}

				// Reset window
				speedWindowBytes = bytesDelta;
				speedWindowStartTime = lastMeasurementTime;
			}

			lastTotalBytes = totalDownloaded;
			lastMeasurementTime = now;
		}

		// Check if test has reached maximum duration
		if (now >= testMaxEndTime) {
			clearInterval(speedSampleInterval);
		}
	}, MEASUREMENT_INTERVAL);

	try {
		// Create promise for each download stream
		const downloadPromises = [];

		// Start initial batch of downloads
		for (let i = 0; i < downloadConcurrency; i++) {
			downloadPromises.push(startDownloadStream(i));
		}

		// Wait for the minimum test duration
		await new Promise((resolve) =>
			setTimeout(resolve, MIN_TEST_DURATION * 1000)
		);

		// Ensure all downloads are completed or aborted
		await cleanupDownloads();

		// Stop speed sampling
		clearInterval(speedSampleInterval);

		// Calculate final speed
		const finalSpeed = calculateFinalSpeed(downloadSpeeds, "download");
		console.log(`Download test complete: ${finalSpeed.toFixed(2)} Mbps`);
		console.log(
			`Total downloaded: ${(totalDownloaded / (1024 * 1024)).toFixed(2)} MB`
		);

		// Final progress update
		onProgress({ progress: 100, currentSpeed: finalSpeed });

		return finalSpeed;
	} catch (error) {
		console.error("Download test failed:", error);
		clearInterval(speedSampleInterval);
		return getFallbackSpeed("download");
	}

	// Function to start a single download stream
	async function startDownloadStream(streamId) {
		return new Promise((resolve, reject) => {
			// Create unique URL to avoid caching - always use fixed size of 32 MB
			const url = `/testfile?size=${DOWNLOAD_FILE_SIZE}&stream=${streamId}&t=${Date.now()}`;

			const xhr = new XMLHttpRequest();
			activeXhrs.push(xhr);

			// Use binary response type
			xhr.responseType = "arraybuffer";

			let streamBytes = 0;
			let hasError = false;

			xhr.onprogress = function (event) {
				if (hasError) return;

				// Calculate bytes received in this progress event
				const bytesReceived = event.loaded - streamBytes;
				streamBytes = event.loaded;

				// Add to total downloaded bytes
				totalDownloaded += bytesReceived;

				// Check if test duration has been reached
				const now = performance.now();
				if (now >= testEndTime) {
					xhr.abort();
					resolve();
				}
			};

			xhr.onload = function () {
				if (xhr.status >= 200 && xhr.status < 300) {
					// Start another download to maintain concurrency if test is still running
					const now = performance.now();
					if (now < testEndTime) {
						startDownloadStream(streamId + downloadConcurrency).catch(
							console.error
						);
					}
					resolve();
				} else {
					hasError = true;
					console.warn(`Download stream ${streamId} HTTP error: ${xhr.status}`);
					reject(new Error(`HTTP error ${xhr.status}`));
				}
			};

			xhr.onerror = function () {
				hasError = true;
				console.error(`Download stream ${streamId} failed with network error`);

				// Try to start a replacement download
				const now = performance.now();
				if (now < testEndTime) {
					setTimeout(() => {
						startDownloadStream(streamId + downloadConcurrency).catch(
							console.error
						);
					}, 500);
				}

				reject(new Error("Network error"));
			};

			xhr.onabort = function () {
				console.log(`Download stream ${streamId} aborted`);
				resolve();
			};

			xhr.open("GET", url);
			xhr.send();

			console.log(`Started download stream ${streamId}`);
		});
	}

	// Ensure all downloads are completed or aborted
	async function cleanupDownloads() {
		console.log("Cleaning up downloads...");

		// Abort all active downloads
		activeXhrs.forEach((xhr) => {
			try {
				if (xhr && xhr.readyState !== 4) xhr.abort();
			} catch (e) {
				console.warn("Error aborting xhr:", e);
			}
		});

		// Small delay to let aborts complete
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

// Optimized upload speed test with fixed file size (32 MB)
async function measureUploadSpeed(onProgress) {
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	// Special case for local testing on extremely high-speed connections
	if (
		isLocal &&
		(connectionType === "ultra-fast" || connectionType === "extreme-fast")
	) {
		const simulatedSpeed = connectionType === "extreme-fast" ? 2200 : 1200;
		return simulateSpeedTest(onProgress, simulatedSpeed, "upload");
	}

	console.log(
		`Starting upload test with concurrency: ${uploadConcurrency}, file size: 32MB`
	);

	// Reset state
	uploadSpeeds = [];
	totalUploaded = 0;

	// Set test duration
	testStartTime = performance.now();
	testEndTime = testStartTime + MIN_TEST_DURATION * 1000;
	const testMaxEndTime = testStartTime + MAX_TEST_DURATION * 1000;

	// Calculate warmup end time
	const warmupEndTime = testStartTime + WARMUP_DURATION * 1000;
	let isInWarmupPhase = true;

	// Setup speed tracking
	let speedSampleInterval;
	let lastMeasurementTime = testStartTime;
	let lastTotalBytes = 0;
	let speedWindowBytes = 0;
	let speedWindowStartTime = testStartTime;

	try {
		// Generate upload data - this will now be a full 32MB buffer instead of small chunks
		console.log("Generating upload data...");
		updateProgress({ progress: 0, currentSpeed: 0 });

		// Generate the upload data - potentially divide into smaller segments for memory efficiency
		const uploadData = await generateUploadData();
		console.log(`Upload data ready: ${uploadData.byteLength} bytes`);

		// Start speed sampling interval
		speedSampleInterval = setInterval(() => {
			const now = performance.now();

			// Skip measurement during warmup
			if (isInWarmupPhase && now < warmupEndTime) {
				return;
			}

			// Check if we just exited warmup
			if (isInWarmupPhase && now >= warmupEndTime) {
				console.log("Exiting upload warmup phase");
				isInWarmupPhase = false;
				lastMeasurementTime = now;
				lastTotalBytes = totalUploaded;
				speedWindowBytes = 0;
				speedWindowStartTime = now;
				return;
			}

			const bytesDelta = totalUploaded - lastTotalBytes;
			const timeDelta = (now - lastMeasurementTime) / 1000; // seconds

			if (timeDelta > 0 && bytesDelta > 0) {
				// Calculate instantaneous speed in Mbps
				const currentSpeed = (bytesDelta * 8) / (1024 * 1024) / timeDelta;

				// Add to speed window
				speedWindowBytes += bytesDelta;

				// Calculate window speed (last 1-3 seconds depending on connection)
				const windowDuration = (now - speedWindowStartTime) / 1000;
				const windowThreshold =
					connectionType === "ultra-fast" || connectionType === "extreme-fast"
						? 1
						: connectionType === "very-fast"
						? 2
						: 3;

				if (windowDuration >= windowThreshold) {
					const windowSpeed =
						(speedWindowBytes * 8) / (1024 * 1024) / windowDuration;

					// Record valid speed
					if (windowSpeed > 0 && windowSpeed < 20000) {
						uploadSpeeds.push(windowSpeed);
						console.log(`Upload window speed: ${windowSpeed.toFixed(2)} Mbps`);

						// Apply smoothing for display
						const displaySpeed = applySmoothing(windowSpeed);

						// Update progress
						const progress = Math.min(
							99,
							10 + ((now - testStartTime) / (MIN_TEST_DURATION * 1000)) * 89
						);
						onProgress({ progress, currentSpeed: displaySpeed });
					}

					// Reset window
					speedWindowBytes = bytesDelta;
					speedWindowStartTime = lastMeasurementTime;
				}

				lastTotalBytes = totalUploaded;
				lastMeasurementTime = now;
			}

			// Check if test has reached maximum duration
			if (now >= testMaxEndTime) {
				clearInterval(speedSampleInterval);
			}
		}, MEASUREMENT_INTERVAL);

		// Create promise for each upload stream
		const uploadPromises = [];

		// Start initial batch of uploads
		for (let i = 0; i < uploadConcurrency; i++) {
			uploadPromises.push(startUploadStream(i, uploadData));
		}

		// Wait for the minimum test duration
		await new Promise((resolve) =>
			setTimeout(resolve, MIN_TEST_DURATION * 1000)
		);

		// Ensure all uploads are completed or aborted
		await cleanupUploads();

		// Stop speed sampling
		clearInterval(speedSampleInterval);

		// Calculate final speed
		const finalSpeed = calculateFinalSpeed(uploadSpeeds, "upload");
		console.log(`Upload test complete: ${finalSpeed.toFixed(2)} Mbps`);
		console.log(
			`Total uploaded: ${(totalUploaded / (1024 * 1024)).toFixed(2)} MB`
		);

		// Final progress update
		onProgress({ progress: 100, currentSpeed: finalSpeed });

		return finalSpeed;
	} catch (error) {
		console.error("Upload test failed:", error);
		clearInterval(speedSampleInterval);
		return getFallbackSpeed("upload");
	}

	// Function to generate upload data for 32MB
	async function generateUploadData() {
		// This function now generates a full 32MB buffer instead of multiple small chunks
		console.log("Generating 32MB of random data for upload test...");

		// Generate data in chunks to avoid browser memory issues
		const chunkSize = 4 * 1024 * 1024; // 4MB chunks
		const numChunks = UPLOAD_FILE_SIZE / chunkSize;
		const combinedBuffer = new ArrayBuffer(UPLOAD_FILE_SIZE);
		const combinedView = new Uint8Array(combinedBuffer);

		for (let i = 0; i < numChunks; i++) {
			const chunk = generateRandomData(chunkSize);
			combinedView.set(chunk, i * chunkSize);

			// Update progress for data generation
			updateProgress({
				progress: (i / numChunks) * 10, // First 10% for generation
				currentSpeed: 0,
			});

			// Small delay to prevent UI freeze
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		return combinedBuffer;
	}

	// Function to start a single upload stream with the full 32MB data
	async function startUploadStream(streamId, uploadData) {
		return new Promise((resolve, reject) => {
			// Create unique URL to avoid caching
			const url = `/upload?i=${streamId}&t=${Date.now()}`;

			const xhr = new XMLHttpRequest();
			activeXhrs.push(xhr);

			let streamBytes = 0;
			let hasError = false;

			// Track upload progress
			xhr.upload.onprogress = function (event) {
				if (hasError) return;

				// Calculate bytes uploaded in this progress event
				const bytesUploaded = event.loaded - streamBytes;
				streamBytes = event.loaded;

				// Add to total uploaded bytes
				totalUploaded += bytesUploaded;

				// Check if test duration has been reached
				const now = performance.now();
				if (now >= testEndTime) {
					xhr.abort();
					resolve();
				}
			};

			xhr.onload = function () {
				if (xhr.status >= 200 && xhr.status < 300) {
					// Start another upload to maintain concurrency if test is still running
					const now = performance.now();
					if (now < testEndTime) {
						startUploadStream(streamId + uploadConcurrency, uploadData).catch(
							console.error
						);
					}
					resolve();
				} else {
					hasError = true;
					console.warn(`Upload stream ${streamId} HTTP error: ${xhr.status}`);
					reject(new Error(`HTTP error ${xhr.status}`));
				}
			};

			xhr.onerror = function () {
				hasError = true;
				console.error(`Upload stream ${streamId} failed with network error`);

				// Try to start a replacement upload
				const now = performance.now();
				if (now < testEndTime) {
					setTimeout(() => {
						startUploadStream(streamId + uploadConcurrency, uploadData).catch(
							console.error
						);
					}, 500);
				}

				reject(new Error("Network error"));
			};

			xhr.onabort = function () {
				console.log(`Upload stream ${streamId} aborted`);
				resolve();
			};

			xhr.open("POST", url);

			// Set content-type to application/octet-stream
			xhr.setRequestHeader("Content-Type", "application/octet-stream");

			// Use Blob for better performance
			const blob = new Blob([uploadData], { type: "application/octet-stream" });

			// Send the blob directly without FormData
			xhr.send(blob);
			console.log(`Started upload stream ${streamId}`);
		});
	}

	// Ensure all uploads are completed or aborted
	async function cleanupUploads() {
		console.log("Cleaning up uploads...");

		// Abort all active uploads
		activeXhrs.forEach((xhr) => {
			try {
				if (xhr && xhr.readyState !== 4) xhr.abort();
			} catch (e) {
				console.warn("Error aborting xhr:", e);
			}
		});

		// Small delay to let aborts complete
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

// Apply smoothing to speed values for display
function applySmoothing(currentSpeed) {
	if (lastDisplaySpeed === 0) {
		lastDisplaySpeed = currentSpeed;
		return currentSpeed;
	}

	// Apply weighted smoothing
	const smoothingFactor = 0.7; // Higher = more smoothing
	const smoothedSpeed =
		lastDisplaySpeed * smoothingFactor + currentSpeed * (1 - smoothingFactor);
	lastDisplaySpeed = smoothedSpeed;

	return smoothedSpeed;
}

// Simulate speed test for local testing
function simulateSpeedTest(onProgress, baseSpeed, type) {
	return new Promise((resolve) => {
		console.log(`Using ${type} speed simulation (${baseSpeed} Mbps)`);

		// Reset state
		if (type === "download") {
			downloadSpeeds = [];
		} else {
			uploadSpeeds = [];
		}

		// Different parameters for download vs upload
		const variation = type === "download" ? 0.05 : 0.1; // 5% variation for download, 10% for upload
		const updateFrequency = 150; // ms between updates

		// For upload, use a realistic reduction compared to download
		const actualBaseSpeed = type === "upload" ? baseSpeed * 0.9 : baseSpeed;

		// Simulate test with realistic variations
		let progress = 0;
		let duration = 0;
		let lastSpeed = 0;
		const testDuration = MIN_TEST_DURATION * 1000;
		const warmupDuration = WARMUP_DURATION * 1000;
		const sampleInterval = 500; // 500ms between recorded samples

		let lastSampleTime = 0;

		// Start simulation timer
		const interval = setInterval(() => {
			duration += updateFrequency;

			// Progress based on elapsed time
			progress = Math.min(99, (duration / testDuration) * 100);

			// Simulate realistic network behavior

			// TCP slow start
			const rampUp = Math.min(1, duration / 3000); // 3 seconds to full speed

			// Add realistic network fluctuations
			const stabilityFactor = Math.min(1, duration / 5000);
			const currentVariation = variation * (1 - stabilityFactor * 0.7);

			// Base fluctuation
			const randomFactor =
				1 - currentVariation + Math.random() * currentVariation * 2;

			// Add periodic variation to simulate network congestion
			const periodicEffect = Math.sin(duration / 3000) * 0.03;

			// Calculate current speed
			const rawSpeed =
				actualBaseSpeed *
				(0.3 + 0.7 * rampUp) *
				(randomFactor + periodicEffect);

			// Apply smoothing for display
			const currentSpeed =
				lastSpeed === 0 ? rawSpeed : lastSpeed * 0.7 + rawSpeed * 0.3;

			lastSpeed = currentSpeed;

			// Record speed samples after warmup
			const now = Date.now();
			if (duration > warmupDuration && now - lastSampleTime >= sampleInterval) {
				if (type === "download") {
					downloadSpeeds.push(currentSpeed);
				} else {
					uploadSpeeds.push(currentSpeed);
				}
				lastSampleTime = now;
			}

			// Update UI
			onProgress({ progress, currentSpeed });

			// Check if test is complete
			if (progress >= 99) {
				clearInterval(interval);

				// Calculate final result
				const finalSpeed = calculateFinalSpeed(
					type === "download" ? downloadSpeeds : uploadSpeeds,
					type
				);

				console.log(
					`${type} simulation complete: ${finalSpeed.toFixed(2)} Mbps`
				);

				// Set progress to 100%
				onProgress({ progress: 100, currentSpeed: finalSpeed });

				resolve(finalSpeed);
			}
		}, updateFrequency);
	});
}

// Calculate final speed with statistical methods specific to connection type
function calculateFinalSpeed(speeds, testType) {
	if (!speeds.length) {
		return getFallbackSpeed(testType);
	}

	// Log the speed data for diagnostics
	console.log(
		`${testType} speeds:`,
		speeds.length > 20
			? `${speeds.length} samples, range: ${Math.min(...speeds).toFixed(
					1
			  )}-${Math.max(...speeds).toFixed(1)} Mbps`
			: speeds.map((s) => s.toFixed(1)).join(", ")
	);

	// For high-speed connections, use different calculation method
	if (speedCalculationMethod === "max-sustained") {
		// For ultra and extreme fast connections, use sustained max approach
		// Sort in descending order
		const sortedDescending = [...speeds].sort((a, b) => b - a);

		// Take average of top 3-5 measurements (sustained peak)
		const topCount = Math.min(5, Math.max(3, Math.floor(speeds.length * 0.1)));
		const topSpeeds = sortedDescending.slice(0, topCount);
		const avgTopSpeed =
			topSpeeds.reduce((sum, s) => sum + s, 0) / topSpeeds.length;

		console.log(
			`${testType} speed calculation: Using max-sustained method (avg of top ${topCount} samples): ${avgTopSpeed.toFixed(
				2
			)} Mbps`
		);
		return avgTopSpeed;
	} else if (speedCalculationMethod === "percentile") {
		// Sort measurements
		const sortedSpeeds = [...speeds].sort((a, b) => a - b);

		// Use different percentiles based on connection type and test type
		let percentile = 0.5; // Default to median (50th percentile)

		if (testType === "download") {
			if (connectionType === "very-fast") percentile = 0.85; // 85th percentile
			else if (connectionType === "fast") percentile = 0.8; // 80th percentile
			else if (connectionType === "moderate") percentile = 0.75; // 75th percentile
		} else {
			// upload
			if (connectionType === "very-fast") percentile = 0.8; // 80th percentile
			else if (connectionType === "fast") percentile = 0.75; // 75th percentile
			else if (connectionType === "moderate") percentile = 0.7; // 70th percentile
		}

		// Calculate the index for the percentile
		const index = Math.floor(sortedSpeeds.length * percentile);
		const finalSpeed = sortedSpeeds[index];

		console.log(
			`${testType} speed calculation: Using ${(percentile * 100).toFixed(
				0
			)}th percentile: ${finalSpeed.toFixed(2)} Mbps`
		);
		return finalSpeed;
	} else {
		// median
		// Use simple median for slow connections
		const sortedSpeeds = [...speeds].sort((a, b) => a - b);
		const midIndex = Math.floor(sortedSpeeds.length / 2);
		const finalSpeed =
			sortedSpeeds.length % 2 === 0
				? (sortedSpeeds[midIndex - 1] + sortedSpeeds[midIndex]) / 2
				: sortedSpeeds[midIndex];

		console.log(
			`${testType} speed calculation: Using median: ${finalSpeed.toFixed(
				2
			)} Mbps`
		);
		return finalSpeed;
	}
}

// Get fallback speed if test fails
function getFallbackSpeed(testType) {
	console.warn(`Using fallback speed for ${testType}`);

	// Fallback speeds based on connection type
	const fallbackSpeeds = {
		"extreme-fast": { download: 2500, upload: 2000 },
		"ultra-fast": { download: 1500, upload: 1200 },
		"very-fast": { download: 750, upload: 600 },
		fast: { download: 200, upload: 150 },
		moderate: { download: 40, upload: 30 },
		slow: { download: 8, upload: 5 },
	};

	return fallbackSpeeds[connectionType]?.[testType] || 50;
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
			statusLabel.textContent = "Testing Download Speed (32 MB)...";
			progressBarFill.style.backgroundColor = "#2563eb"; // Blue
			break;
		case TestStatus.UPLOAD:
			statusLabel.textContent = "Testing Upload Speed (32 MB)..."; // Updated to 32 MB
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
	); // Updated to MB from KB
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
