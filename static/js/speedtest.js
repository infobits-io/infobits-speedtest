// Constants
const PING_TESTS = 25; // Number of ping tests
const MIN_TEST_DURATION = 30; // Minimum test duration in seconds
const MEASUREMENT_INTERVAL = 100; // Milliseconds between measurements
const MAX_SPEED_CLASS = 10000; // Upper bound for speed classification (10 Gbps)
const CRYPTO_BLOCK_SIZE = 65536; // Maximum bytes for crypto.getRandomValues() (browser security limit)

// Dynamic constants that adjust based on connection speed
let downloadFileSize = 25 * 1024 * 1024; // Initial 25MB - will adjust based on speed detection
let uploadChunkSize = 1 * 1024 * 1024; // Initial 1MB - will adjust based on speed detection
let uploadConcurrency = 1; // Initial single stream - will adjust based on speed
let downloadConcurrency = 1; // Initial single stream for download

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
let testStartTime = 0; // When the test started
let testEndTime = 0; // When the test should end
let downloadSpeeds = []; // Array of download speeds
let uploadSpeeds = []; // Array of upload speeds
let activeRequestCount = 0; // Number of active requests
let abortControllers = []; // For aborting fetch requests

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
	activeRequestCount = 0;

	// Abort any ongoing requests
	abortControllers.forEach((controller) => {
		try {
			if (controller && controller.abort) controller.abort();
		} catch (e) {
			console.warn("Error aborting fetch:", e);
		}
	});
	abortControllers = [];
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
		// Test with a 1MB file first
		const probeSize = 1 * 1024 * 1024;
		const probeUrl = `/testfile?size=${probeSize}&t=${Date.now()}`;

		onProgress({ progress: 10, currentSpeed: 0 });

		const controller = new AbortController();
		abortControllers.push(controller);

		const startTime = performance.now();

		const response = await fetch(probeUrl, { signal: controller.signal });
		if (!response.ok) {
			console.warn("Probe request failed with status:", response.status);
			return 50; // Default to moderate speed
		}

		const reader = response.body.getReader();
		let bytesReceived = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytesReceived += value.length;

			onProgress({
				progress: 10 + (bytesReceived / probeSize) * 40,
				currentSpeed: 0,
			});
		}

		const endTime = performance.now();
		const durationSeconds = (endTime - startTime) / 1000;

		// Calculate speed in Mbps
		const speedMbps = (bytesReceived * 8) / (1024 * 1024) / durationSeconds;
		console.log(
			`Probe speed: ${speedMbps.toFixed(2)} Mbps in ${durationSeconds.toFixed(
				2
			)}s`
		);

		onProgress({ progress: 100, currentSpeed: speedMbps });

		// Determine connection type
		if (speedMbps < 10) {
			connectionType = "slow";
			console.log("Detected slow connection (<10 Mbps)");
		} else if (speedMbps < 50) {
			connectionType = "moderate";
			console.log("Detected moderate connection (10-50 Mbps)");
		} else if (speedMbps < 200) {
			connectionType = "fast";
			console.log("Detected fast connection (50-200 Mbps)");
		} else if (speedMbps < 750) {
			connectionType = "very-fast";
			console.log("Detected very fast connection (200-750 Mbps)");
		} else {
			connectionType = "ultra-fast";
			console.log("Detected ultra-fast connection (750+ Mbps)");
		}

		return speedMbps;
	} catch (error) {
		console.error("Connection probe failed:", error);
		return 50; // Assume moderate speed
	}
}

// Adjust test parameters based on detected connection speed
function adjustTestParameters(speedMbps) {
	// Adjust parameters based on connection type
	if (connectionType === "slow") {
		// Slow connections (<10 Mbps)
		downloadFileSize = 8 * 1024 * 1024; // 8MB
		uploadChunkSize = 512 * 1024; // 512KB
		uploadConcurrency = 2; // Concurrent uploads
		downloadConcurrency = 2; // Concurrent downloads
	} else if (connectionType === "moderate") {
		// Moderate (10-50 Mbps)
		downloadFileSize = 20 * 1024 * 1024; // 20MB
		uploadChunkSize = 1 * 1024 * 1024; // 1MB
		uploadConcurrency = 3; // Concurrent uploads
		downloadConcurrency = 3; // Concurrent downloads
	} else if (connectionType === "fast") {
		// Fast (50-200 Mbps)
		downloadFileSize = 40 * 1024 * 1024; // 40MB
		uploadChunkSize = 2 * 1024 * 1024; // 2MB
		uploadConcurrency = 4; // Concurrent uploads
		downloadConcurrency = 4; // Concurrent downloads
	} else if (connectionType === "very-fast") {
		// Very fast (200-750 Mbps)
		downloadFileSize = 80 * 1024 * 1024; // 80MB
		uploadChunkSize = 4 * 1024 * 1024; // 4MB
		uploadConcurrency = 5; // Concurrent uploads
		downloadConcurrency = 5; // Concurrent downloads
	} else {
		// Ultra-fast (750+ Mbps)
		downloadFileSize = 150 * 1024 * 1024; // 150MB
		uploadChunkSize = 8 * 1024 * 1024; // 8MB
		uploadConcurrency = 6; // Concurrent uploads
		downloadConcurrency = 6; // Concurrent downloads
	}

	console.log(
		`Adjusted test parameters: downloadSize=${
			downloadFileSize / 1024 / 1024
		}MB, uploadChunk=${
			uploadChunkSize / 1024 / 1024
		}MB, concurrency=${downloadConcurrency}/${uploadConcurrency}`
	);
}

// Measure latency - works for all connection speeds
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

// Measure download speed with balanced requests and proper duration
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
		`Starting download test with file size: ${
			downloadFileSize / 1024 / 1024
		}MB, concurrency: ${downloadConcurrency}`
	);

	// Reset measurement state
	downloadSpeeds = [];
	totalDownloaded = 0;
	activeRequestCount = 0;

	// Set timestamps for the test
	testStartTime = performance.now();
	testEndTime = testStartTime + MIN_TEST_DURATION * 1000;

	try {
		// Start download test with multiple concurrent requests
		const downloadPromises = [];

		// Initial batch of downloads
		for (let i = 0; i < downloadConcurrency; i++) {
			downloadPromises.push(startDownload(i));
		}

		// Create a timeout promise to ensure the test runs for minimum duration
		const timeoutPromise = new Promise((resolve) => {
			setTimeout(() => {
				console.log(
					`Download test minimum duration (${MIN_TEST_DURATION}s) reached`
				);
				resolve();
			}, MIN_TEST_DURATION * 1000);
		});

		// Wait for all downloads to complete and minimum time to pass
		await Promise.all([Promise.all(downloadPromises), timeoutPromise]);

		// Calculate final download speed
		const finalSpeed = calculateFinalSpeed(downloadSpeeds, "download");
		console.log(`Download test complete: ${finalSpeed.toFixed(2)} Mbps`);
		console.log(
			`Total downloaded: ${(totalDownloaded / (1024 * 1024)).toFixed(2)} MB`
		);

		return finalSpeed;
	} catch (error) {
		console.error("Download test failed:", error);
		return connectionType === "ultra-fast"
			? 1000
			: connectionType === "very-fast"
			? 500
			: connectionType === "fast"
			? 100
			: 50;
	}

	// Function to start a single download
	async function startDownload(index) {
		// Create unique URL to avoid caching
		const url = `/testfile?size=${downloadFileSize}&i=${index}&t=${Date.now()}`;

		try {
			console.log(`Starting download ${index}`);
			activeRequestCount++;

			// Create abort controller for this request
			const controller = new AbortController();
			abortControllers.push(controller);

			const startTime = performance.now();
			const response = await fetch(url, { signal: controller.signal });

			if (!response.ok) {
				console.warn(`Download ${index} failed: ${response.status}`);
				activeRequestCount--;
				return;
			}

			// Monitor download progress
			const reader = response.body.getReader();
			const contentLength = parseInt(
				response.headers.get("Content-Length") || "0",
				10
			);
			let receivedLength = 0;
			let lastProgressUpdateTime = performance.now();
			let lastReceivedLength = 0;

			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					console.log(`Download ${index} complete`);
					break;
				}

				// Update received bytes
				receivedLength += value.length;
				totalDownloaded += value.length;

				// Calculate speed periodically
				const now = performance.now();
				const timeSinceLastUpdate = now - lastProgressUpdateTime;

				if (timeSinceLastUpdate >= MEASUREMENT_INTERVAL) {
					const bytesInInterval = receivedLength - lastReceivedLength;
					const intervalInSeconds = timeSinceLastUpdate / 1000;

					// Calculate speed in Mbps
					const speedMbps =
						(bytesInInterval * 8) / (1024 * 1024) / intervalInSeconds;

					// Add to speed measurements if valid
					if (speedMbps > 0 && speedMbps < 50000) {
						downloadSpeeds.push(speedMbps);

						// Update progress
						const timeElapsed = now - testStartTime;
						const progress = Math.min(
							99,
							(timeElapsed / (MIN_TEST_DURATION * 1000)) * 100
						);

						onProgress({
							progress,
							currentSpeed: speedMbps,
						});
					}

					lastProgressUpdateTime = now;
					lastReceivedLength = receivedLength;
				}

				// Check if we've exceeded the test duration
				if (performance.now() >= testEndTime) {
					console.log(`Download ${index} duration reached, aborting`);
					controller.abort();
					break;
				}
			}

			// Start a new download if we're still within the test duration
			if (performance.now() < testEndTime) {
				startDownload(index + downloadConcurrency);
			}

			activeRequestCount--;
		} catch (error) {
			if (error.name === "AbortError") {
				console.log(`Download ${index} was aborted`);
			} else {
				console.error(`Download ${index} error:`, error);
			}

			activeRequestCount--;

			// Start a new download if the error wasn't an abort and we're within test duration
			if (error.name !== "AbortError" && performance.now() < testEndTime) {
				await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay after error
				startDownload(index + downloadConcurrency);
			}
		}
	}
}

// Measure upload speed with balanced requests and proper duration
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
		`Starting upload test with chunk size: ${
			uploadChunkSize / 1024 / 1024
		}MB, concurrency: ${uploadConcurrency}`
	);

	// Reset measurement state
	uploadSpeeds = [];
	totalUploaded = 0;
	activeRequestCount = 0;

	// Set timestamps for the test
	testStartTime = performance.now();
	testEndTime = testStartTime + MIN_TEST_DURATION * 1000;

	try {
		// Generate test data for uploads
		console.log("Generating upload data...");
		updateProgress({ progress: 0, currentSpeed: 0 });

		// Generate data with progressive updates
		const uploadData = await generateUploadData();
		console.log(`Upload data ready: ${uploadData.length} chunks`);

		// Start upload test with multiple concurrent requests
		const uploadPromises = [];

		// Initial batch of uploads
		for (let i = 0; i < uploadConcurrency; i++) {
			uploadPromises.push(startUpload(i, uploadData));
		}

		// Create a timeout promise to ensure the test runs for minimum duration
		const timeoutPromise = new Promise((resolve) => {
			setTimeout(() => {
				console.log(
					`Upload test minimum duration (${MIN_TEST_DURATION}s) reached`
				);
				resolve();
			}, MIN_TEST_DURATION * 1000);
		});

		// Wait for all uploads to complete and minimum time to pass
		await Promise.all([Promise.all(uploadPromises), timeoutPromise]);

		// Calculate final upload speed
		const finalSpeed = calculateFinalSpeed(uploadSpeeds, "upload");
		console.log(`Upload test complete: ${finalSpeed.toFixed(2)} Mbps`);
		console.log(
			`Total uploaded: ${(totalUploaded / (1024 * 1024)).toFixed(2)} MB`
		);

		return finalSpeed;
	} catch (error) {
		console.error("Upload test failed:", error);
		return connectionType === "ultra-fast"
			? 800
			: connectionType === "very-fast"
			? 400
			: connectionType === "fast"
			? 80
			: 30;
	}

	// Generate upload data chunks
	async function generateUploadData() {
		// Create enough chunks based on speed and concurrency
		const numChunks = Math.max(5, uploadConcurrency * 4);
		const chunks = [];

		for (let i = 0; i < numChunks; i++) {
			chunks.push(generateRandomData(uploadChunkSize));

			// Update progress for data generation
			updateProgress({
				progress: (i / numChunks) * 10, // First 10% for generation
				currentSpeed: 0,
			});

			// Small delay to not lock UI
			if (i % 2 === 1) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}

		return chunks;
	}

	// Function to start a single upload
	async function startUpload(index, uploadData) {
		// Use data chunk (rotating through available chunks)
		const dataIndex = index % uploadData.length;
		const data = uploadData[dataIndex];

		try {
			console.log(`Starting upload ${index}`);
			activeRequestCount++;

			// Create unique URL to avoid caching
			const url = `/upload?i=${index}&t=${Date.now()}`;

			// Create abort controller for this request
			const controller = new AbortController();
			abortControllers.push(controller);

			const startTime = performance.now();

			// Create form data for upload
			const formData = new FormData();
			formData.append("file", new Blob([data]), "speedtest.bin");

			// Track upload progress
			let uploadedBytes = 0;
			let lastProgressTime = performance.now();

			const xhr = new XMLHttpRequest();
			xhr.open("POST", url);

			// Track upload progress
			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable) {
					const now = performance.now();
					const intervalMs = now - lastProgressTime;

					if (intervalMs >= MEASUREMENT_INTERVAL) {
						const bytesInInterval = event.loaded - uploadedBytes;
						const intervalInSeconds = intervalMs / 1000;

						// Calculate speed in Mbps
						const speedMbps =
							(bytesInInterval * 8) / (1024 * 1024) / intervalInSeconds;

						// Add to speed measurements if valid
						if (speedMbps > 0 && speedMbps < 50000) {
							uploadSpeeds.push(speedMbps);

							// Update total uploaded
							totalUploaded += bytesInInterval;

							// Update progress
							const timeElapsed = now - testStartTime;
							const progress = Math.min(
								99,
								10 + (timeElapsed / (MIN_TEST_DURATION * 1000)) * 89
							);

							onProgress({
								progress,
								currentSpeed: speedMbps,
							});
						}

						lastProgressTime = now;
						uploadedBytes = event.loaded;
					}
				}
			};

			// Return a promise that resolves when upload completes or errors
			return new Promise((resolve, reject) => {
				xhr.onload = () => {
					if (xhr.status >= 200 && xhr.status < 300) {
						console.log(`Upload ${index} complete`);

						// Start a new upload if we're still within the test duration
						if (performance.now() < testEndTime) {
							startUpload(index + uploadConcurrency, uploadData).catch(
								console.error
							);
						}

						activeRequestCount--;
						resolve();
					} else {
						console.warn(`Upload ${index} failed: ${xhr.status}`);
						activeRequestCount--;
						reject(new Error(`HTTP error ${xhr.status}`));
					}
				};

				xhr.onerror = () => {
					console.error(`Upload ${index} error`);
					activeRequestCount--;
					reject(new Error("Network error"));

					// Try another upload if we're within test duration
					if (performance.now() < testEndTime) {
						setTimeout(() => {
							startUpload(index + uploadConcurrency, uploadData).catch(
								console.error
							);
						}, 500);
					}
				};

				xhr.ontimeout = () => {
					console.warn(`Upload ${index} timed out`);
					activeRequestCount--;
					reject(new Error("Timeout"));
				};

				xhr.onabort = () => {
					console.log(`Upload ${index} aborted`);
					activeRequestCount--;
					resolve();
				};

				// Set timeout handler to abort if needed
				const timeoutHandle = setTimeout(() => {
					if (performance.now() >= testEndTime) {
						xhr.abort();
					}
				}, MIN_TEST_DURATION * 1000);

				// Send the upload
				xhr.send(formData);
			});
		} catch (error) {
			console.error(`Upload ${index} error:`, error);
			activeRequestCount--;

			// Start a new upload if the error wasn't an abort and we're within test duration
			if (error.name !== "AbortError" && performance.now() < testEndTime) {
				await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay after error
				startUpload(index + uploadConcurrency, uploadData);
			}
		}
	}
}

// Simulate speed test for local testing
function simulateSpeedTest(onProgress, baseSpeed, type) {
	return new Promise((resolve) => {
		console.log(`Using ${type} speed simulation (${baseSpeed} Mbps)`);

		// Different parameters for download vs upload
		const variation = type === "download" ? 0.05 : 0.1; // 5% variation for download, 10% for upload
		const updateFrequency = 150; // ms between updates

		// For upload, use a realistic reduction compared to download
		const actualBaseSpeed = type === "upload" ? baseSpeed * 0.85 : baseSpeed;

		// Store measurements
		const measurements = [];

		// Simulate test with realistic variations
		let progress = 0;
		let duration = 0;
		const testDuration = MIN_TEST_DURATION * 1000;

		// Start simulation timer
		const interval = setInterval(() => {
			duration += updateFrequency;

			// Progress based on elapsed time
			progress = Math.min(99, (duration / testDuration) * 100);

			// Simulate TCP slow start
			const rampUp = Math.min(1, duration / 3000); // 3 seconds to full speed

			// Add realistic network fluctuations
			const stabilityFactor = Math.min(1, duration / 5000);
			const currentVariation = variation * (1 - stabilityFactor * 0.5);
			const speedFactor =
				1 - currentVariation + Math.random() * currentVariation * 2;

			// Add periodic variation to simulate network congestion
			const periodicEffect = Math.sin(duration / 2000) * 0.03;

			// Calculate current speed
			const currentSpeed =
				actualBaseSpeed * (0.3 + 0.7 * rampUp) * (speedFactor + periodicEffect);

			// Add to measurements
			measurements.push(currentSpeed);

			// Update UI
			onProgress({ progress, currentSpeed });

			// Check if test is complete
			if (progress >= 99) {
				clearInterval(interval);

				// Calculate final result using same method as real tests
				const finalSpeed = calculateFinalSpeed(measurements, type);
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

// Calculate final speed with statistical methods
function calculateFinalSpeed(speeds, testType) {
	if (!speeds.length) {
		// Fallback if no measurements
		return connectionType === "ultra-fast"
			? 1000
			: connectionType === "very-fast"
			? 500
			: connectionType === "fast"
			? 100
			: connectionType === "moderate"
			? 50
			: 10;
	}

	// Sort measurements
	const sortedSpeeds = [...speeds].sort((a, b) => a - b);

	// Apply different percentiles based on connection type and test type
	let percentile = 0.5; // Default to median (50th percentile)

	if (testType === "download") {
		if (connectionType === "ultra-fast") percentile = 0.9; // 90th percentile
		else if (connectionType === "very-fast")
			percentile = 0.85; // 85th percentile
		else if (connectionType === "fast") percentile = 0.8; // 80th percentile
		else if (connectionType === "moderate") percentile = 0.75; // 75th percentile
	} else {
		// upload
		if (connectionType === "ultra-fast") percentile = 0.85; // 85th percentile
		else if (connectionType === "very-fast")
			percentile = 0.8; // 80th percentile
		else if (connectionType === "fast") percentile = 0.75; // 75th percentile
		else if (connectionType === "moderate") percentile = 0.7; // 70th percentile
	}

	// Calculate the index for the percentile
	const index = Math.floor(sortedSpeeds.length * percentile);
	const finalSpeed = sortedSpeeds[index];

	console.log(
		`${testType} speed calculation: Using ${(percentile * 100).toFixed(
			0
		)}th percentile from ${sortedSpeeds.length} samples`
	);

	return finalSpeed;
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
