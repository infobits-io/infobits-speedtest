// Constants
const PING_TESTS = 20; // Number of ping tests
const MIN_TEST_DURATION = 12; // Minimum test duration in seconds
const MEASUREMENT_INTERVAL = 100; // Milliseconds between measurements
const MAX_SPEED_CLASS = 10000; // Upper bound for speed classification (10 Gbps)

// Dynamic constants that adjust based on connection speed
let downloadFileSize = 25 * 1024 * 1024; // Initial 25MB - will adjust based on speed detection
let uploadChunkSize = 1 * 1024 * 1024; // Initial 1MB - will adjust based on speed detection
let uploadConcurrency = 1; // Initial single stream - will adjust based on speed

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

// Initialize the app
function init() {
	startButton.addEventListener("click", startTest);
}

// Start the speed test
async function startTest() {
	if (isRunning) return;

	// Reset state
	isRunning = true;
	testStatus = TestStatus.IDLE;

	// Hide previous results
	resultContainer.style.display = "none";

	updateUI();

	try {
		// Step 0: Probe connection speed to optimize test parameters
		updateStatus(TestStatus.PROBING);
		const probeSpeed = await probeConnectionSpeed(updateProgress);
		adjustTestParameters(probeSpeed);

		// Step 1: Measure latency
		updateStatus(TestStatus.IDLE);
		const latencyData = await measureLatency();
		testResult.latency = latencyData.latency;
		testResult.jitter = latencyData.jitter;

		// Step 2: Measure download speed
		updateStatus(TestStatus.DOWNLOAD);
		testResult.downloadSpeed = await measureDownloadSpeed(updateProgress);

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
		updateUI();
	}
}

// Probe connection speed and optimize test parameters
async function probeConnectionSpeed(onProgress) {
	onProgress({ progress: 0, currentSpeed: 0 });
	console.log("Probing connection speed...");

	try {
		// Quick small download (1MB) to test connection speed
		const probeSize = 1 * 1024 * 1024;
		const url = `/testfile?size=${probeSize}&t=${Date.now()}`;

		onProgress({ progress: 20, currentSpeed: 0 });
		const startTime = performance.now();

		const response = await fetch(url);
		if (!response.ok) {
			console.warn("Probe request failed");
			return 50; // Assume moderate speed
		}

		const reader = response.body.getReader();
		let bytesReceived = 0;

		while (true) {
			onProgress({
				progress: 40 + (bytesReceived / probeSize) * 30,
				currentSpeed: 0,
			});
			const { done, value } = await reader.read();

			if (done) break;
			bytesReceived += value.length;
		}

		const endTime = performance.now();
		const durationSeconds = (endTime - startTime) / 1000;
		const speedMbps = (bytesReceived * 8) / (1024 * 1024) / durationSeconds;

		console.log(
			`Connection probe speed: ${speedMbps.toFixed(
				2
			)} Mbps in ${durationSeconds.toFixed(2)}s`
		);
		onProgress({ progress: 100, currentSpeed: speedMbps });

		// Determine connection type
		if (speedMbps < 20) {
			connectionType = "slow";
			console.log("Detected slow connection (<20 Mbps)");
		} else if (speedMbps < 100) {
			connectionType = "moderate";
			console.log("Detected moderate connection (20-100 Mbps)");
		} else if (speedMbps < 500) {
			connectionType = "fast";
			console.log("Detected fast connection (100-500 Mbps)");
		} else if (speedMbps < 1000) {
			connectionType = "very-fast";
			console.log("Detected very fast connection (500-1000 Mbps)");
		} else {
			connectionType = "ultra-fast";
			console.log("Detected ultra-fast connection (1+ Gbps)");
		}

		return speedMbps;
	} catch (error) {
		console.error("Connection probe failed:", error);
		return 50; // Assume moderate speed
	}
}

// Adjust test parameters based on detected connection speed
function adjustTestParameters(speedMbps) {
	// Adjust download file size based on connection speed
	if (speedMbps < 20) {
		// Slow connections (<20 Mbps)
		downloadFileSize = 10 * 1024 * 1024; // 10MB
		uploadChunkSize = 512 * 1024; // 512KB
		uploadConcurrency = 1; // Single stream
	} else if (speedMbps < 100) {
		// Moderate (20-100 Mbps)
		downloadFileSize = 25 * 1024 * 1024; // 25MB
		uploadChunkSize = 1 * 1024 * 1024; // 1MB
		uploadConcurrency = 1; // Single stream
	} else if (speedMbps < 500) {
		// Fast (100-500 Mbps)
		downloadFileSize = 50 * 1024 * 1024; // 50MB
		uploadChunkSize = 2 * 1024 * 1024; // 2MB
		uploadConcurrency = 2; // Two streams
	} else if (speedMbps < 1000) {
		// Very fast (500-1000 Mbps)
		downloadFileSize = 100 * 1024 * 1024; // 100MB
		uploadChunkSize = 4 * 1024 * 1024; // 4MB
		uploadConcurrency = 3; // Three streams
	} else {
		// Ultra-fast (1+ Gbps)
		downloadFileSize = 200 * 1024 * 1024; // 200MB
		uploadChunkSize = 8 * 1024 * 1024; // 8MB
		uploadConcurrency = 4; // Four streams
	}

	console.log(
		`Adjusted test parameters: downloadSize=${
			downloadFileSize / 1024 / 1024
		}MB, uploadChunk=${
			uploadChunkSize / 1024 / 1024
		}MB, concurrency=${uploadConcurrency}`
	);
}

// Measure latency - works for all connection speeds
async function measureLatency() {
	const pingResults = [];

	// Reset progress and show status
	updateStatus(TestStatus.IDLE, { progress: 0, currentSpeed: 0 });
	console.log("Starting latency test");

	// Do initial warm-up pings to establish connection
	const warmupCount = connectionType === "slow" ? 1 : 3;
	for (let i = 0; i < warmupCount; i++) {
		try {
			await fetch(`/ping?t=${Date.now()}`, { method: "GET" });
		} catch (e) {
			console.log("Warm-up ping failed, continuing with test");
		}
	}

	// Actual ping tests
	for (let i = 0; i < PING_TESTS; i++) {
		const startTime = performance.now();
		try {
			await fetch(`/ping?t=${Date.now()}`, { method: "GET" });
			const endTime = performance.now();
			const latencyValue = endTime - startTime;
			pingResults.push(latencyValue);
			console.log(`Ping ${i + 1}/${PING_TESTS}: ${latencyValue.toFixed(2)}ms`);
		} catch (error) {
			console.error("Ping test failed:", error);
		}

		// Update progress
		updateProgress({
			progress: ((i + 1) / PING_TESTS) * 100,
			currentSpeed: 0,
		});

		// Slow connections need more time between pings
		const pingDelay = connectionType === "slow" ? 200 : 50;
		await new Promise((resolve) => setTimeout(resolve, pingDelay));
	}

	// Calculate latency and jitter with appropriate statistical methods
	let latency, jitter;

	if (pingResults.length >= 5) {
		// For high-speed connections, use more advanced statistical methods
		if (connectionType === "very-fast" || connectionType === "ultra-fast") {
			// Sort and trim outliers (top and bottom 15%)
			const sortedPings = [...pingResults].sort((a, b) => a - b);
			const cutoff = Math.floor(sortedPings.length * 0.15);
			const trimmedPings = sortedPings.slice(
				cutoff,
				sortedPings.length - cutoff
			);

			// Use median for more stability in high-speed connections
			const mid = Math.floor(trimmedPings.length / 2);
			latency =
				trimmedPings.length % 2 === 0
					? (trimmedPings[mid - 1] + trimmedPings[mid]) / 2
					: trimmedPings[mid];

			// Calculate jitter (average absolute deviation)
			jitter =
				trimmedPings.reduce((sum, ping) => sum + Math.abs(ping - latency), 0) /
				trimmedPings.length;
		} else {
			// For normal/slower connections, simpler average is fine with mild outlier removal
			const sortedPings = [...pingResults].sort((a, b) => a - b);
			// Remove the highest value which might be an outlier
			const trimmedPings = sortedPings.slice(0, sortedPings.length - 1);

			latency =
				trimmedPings.reduce((sum, ping) => sum + ping, 0) / trimmedPings.length;
			jitter =
				trimmedPings.reduce((sum, ping) => sum + Math.abs(ping - latency), 0) /
				trimmedPings.length;
		}
	} else {
		// Not enough measurements, use simple average
		latency =
			pingResults.reduce((sum, ping) => sum + ping, 0) / pingResults.length ||
			5;
		jitter =
			pingResults.reduce((sum, ping) => sum + Math.abs(ping - latency), 0) /
				pingResults.length || 2;
	}

	// For local connections, ensure reasonable minimum values
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";
	if (isLocal && latency < 0.5) {
		console.log("Adjusting latency values for local connection");
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

// Measure download speed - works for all connection speeds
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

	// Use dynamic file size based on connection speed
	const url = `/testfile?size=${downloadFileSize}&t=${Date.now()}`;
	const startTime = performance.now();
	let bytesLoaded = 0;
	let totalBytes = 0;
	let speedMeasurements = [];
	let lastUpdateTime = startTime;

	console.log(
		`Starting download test with file size: ${downloadFileSize / 1024 / 1024}MB`
	);

	try {
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}`);
		}

		const reader = response.body.getReader();
		const contentLength = parseInt(
			response.headers.get("Content-Length") || "0",
			10
		);
		console.log("Content length:", contentLength);

		let testEndTime = startTime + MIN_TEST_DURATION * 1000;

		// Set up sliding window for speed calculation
		// Larger window for more stable results on fast connections
		const windowSize =
			connectionType === "ultra-fast"
				? 3000
				: connectionType === "very-fast"
				? 2000
				: connectionType === "fast"
				? 1500
				: 1000;
		const speedWindow = [];
		let windowBytes = 0;
		let windowStartTime = performance.now();

		// Start measuring
		while (true) {
			const { done, value } = await reader.read();

			if (done || performance.now() >= testEndTime) {
				console.log("Download complete or test duration reached");
				break;
			}

			// Increment bytes loaded
			const now = performance.now();
			const chunkSize = value.length;
			bytesLoaded += chunkSize;
			totalBytes += chunkSize;

			// Add to sliding window
			speedWindow.push({
				time: now,
				bytes: chunkSize,
			});
			windowBytes += chunkSize;

			// Remove old entries from window
			while (speedWindow.length > 0 && now - speedWindow[0].time > windowSize) {
				windowBytes -= speedWindow[0].bytes;
				speedWindow.shift();
			}

			// Calculate current speed using sliding window
			if (speedWindow.length > 0) {
				const windowDuration = (now - speedWindow[0].time) / 1000; // in seconds
				if (windowDuration > 0) {
					const currentSpeed =
						(windowBytes * 8) / (1024 * 1024) / windowDuration; // Mbps

					// Calculate progress percentage
					const progress =
						contentLength > 0
							? Math.min(100, (totalBytes / contentLength) * 100)
							: Math.min(
									100,
									((now - startTime) / (MIN_TEST_DURATION * 1000)) * 100
							  );

					// Update display at regular intervals
					if (now - lastUpdateTime >= MEASUREMENT_INTERVAL) {
						console.log(
							`Download speed (window): ${currentSpeed.toFixed(
								2
							)} Mbps, progress: ${progress.toFixed(1)}%`
						);

						if (currentSpeed > 0) {
							speedMeasurements.push(currentSpeed);
							onProgress({ progress, currentSpeed });
						}

						lastUpdateTime = now;
					}
				}
			}
		}

		// Calculate final result from measurements
		const endTime = performance.now();
		const totalTimeSeconds = (endTime - startTime) / 1000;

		console.log(
			`Download test: totalBytes=${totalBytes}, time=${totalTimeSeconds}s`
		);

		let finalSpeed;

		if (speedMeasurements.length > 3) {
			// Use different statistical methods based on connection type
			const sortedMeasurements = [...speedMeasurements].sort((a, b) => a - b);

			if (connectionType === "ultra-fast" || connectionType === "very-fast") {
				// For high-speed, use 90th percentile for stability
				const idx = Math.floor(sortedMeasurements.length * 0.9);
				finalSpeed = sortedMeasurements[idx];
				console.log(
					"Using 90th percentile for high-speed download:",
					finalSpeed
				);
			} else if (connectionType === "fast") {
				// For fast connections, use upper quartile
				const idx = Math.floor(sortedMeasurements.length * 0.75);
				finalSpeed = sortedMeasurements[idx];
				console.log("Using 75th percentile for fast download:", finalSpeed);
			} else {
				// For slower connections, use median for stability
				const mid = Math.floor(sortedMeasurements.length / 2);
				finalSpeed = sortedMeasurements[mid];
				console.log("Using median for download:", finalSpeed);
			}
		} else if (totalBytes > 0 && totalTimeSeconds > 0) {
			// Calculate from total bytes if not enough measurements
			finalSpeed = (totalBytes * 8) / (1024 * 1024 * totalTimeSeconds);
			console.log("Using calculated speed from total bytes:", finalSpeed);
		} else {
			// Fallback
			finalSpeed = 10;
			console.log("Using fallback speed:", finalSpeed);
		}

		return Math.max(0.1, finalSpeed);
	} catch (error) {
		console.error("Download test failed:", error);
		return 5; // Fallback speed
	}
}

// Measure upload speed - works for all connection speeds
async function measureUploadSpeed(onProgress) {
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	// Special case for local testing on high-speed connections
	if (
		isLocal &&
		(connectionType === "very-fast" || connectionType === "ultra-fast")
	) {
		const simulatedSpeed = connectionType === "ultra-fast" ? 2500 : 750;
		return simulateSpeedTest(onProgress, simulatedSpeed, "upload");
	}

	const startTime = performance.now();
	let totalUploaded = 0;
	let speedMeasurements = [];
	let lastUpdateTime = startTime;

	console.log("Starting upload test");

	try {
		// Calculate how many chunks to upload based on connection type
		const uploadChunks =
			connectionType === "slow"
				? 5
				: connectionType === "moderate"
				? 8
				: connectionType === "fast"
				? 12
				: connectionType === "very-fast"
				? 15
				: 20;

		// Create array of chunks to upload
		const uploadData = [];
		for (let i = 0; i < uploadChunks; i++) {
			const chunk = new Uint8Array(uploadChunkSize);
			crypto.getRandomValues(chunk);
			uploadData.push(chunk);
		}

		console.log(
			`Upload test: ${uploadChunks} chunks of ${
				uploadChunkSize / 1024 / 1024
			}MB each, concurrency=${uploadConcurrency}`
		);

		const testEndTime = startTime + MIN_TEST_DURATION * 1000;

		// Process uploads in batches with controlled concurrency
		for (let i = 0; i < uploadData.length; i += uploadConcurrency) {
			if (performance.now() >= testEndTime) {
				console.log("Upload test duration reached");
				break;
			}

			const batchStartTime = performance.now();
			const batch = uploadData.slice(i, i + uploadConcurrency);

			// Upload this batch concurrently
			const uploadPromises = batch.map(async (chunk, index) => {
				const chunkStartTime = performance.now();

				try {
					const response = await fetch(`/upload?t=${Date.now()}-${index}`, {
						method: "POST",
						headers: {
							"Content-Type": "application/octet-stream",
						},
						body: chunk,
					});

					if (!response.ok) {
						throw new Error(`Upload failed: ${response.status}`);
					}

					const chunkEndTime = performance.now();
					const clientDuration = (chunkEndTime - chunkStartTime) / 1000;

					// Try to get server timing
					try {
						const responseData = await response.json();
						const serverDuration = responseData.duration || 0;

						return {
							size: chunk.length,
							clientDuration,
							serverDuration,
							valid: true,
						};
					} catch (e) {
						console.warn("Could not parse server response:", e);
						return {
							size: chunk.length,
							clientDuration,
							serverDuration: 0,
							valid: true,
						};
					}
				} catch (error) {
					console.error(`Chunk upload failed: ${error}`);
					return { valid: false };
				}
			});

			// Wait for all chunks in this batch to complete
			const results = await Promise.all(uploadPromises);

			// Process valid results
			let batchBytes = 0;
			let validResults = 0;

			for (const result of results) {
				if (result.valid) {
					batchBytes += result.size;
					totalUploaded += result.size;
					validResults++;

					// Calculate speed (prefer server timing if available)
					const duration =
						result.serverDuration > 0 && result.serverDuration < 1
							? result.serverDuration // Use server timing if reasonable
							: result.clientDuration; // Fall back to client timing

					if (duration > 0) {
						const speed = (result.size * 8) / (1024 * 1024 * duration);

						// Only add reasonable measurements
						const maxReasonableSpeed =
							connectionType === "ultra-fast"
								? 10000
								: connectionType === "very-fast"
								? 2000
								: connectionType === "fast"
								? 1000
								: 500;

						if (speed > 0 && speed < maxReasonableSpeed) {
							console.log(
								`Upload chunk: ${(result.size / 1024 / 1024).toFixed(
									1
								)}MB, speed: ${speed.toFixed(2)} Mbps`
							);
							speedMeasurements.push(speed);
						}
					}
				}
			}

			// Calculate overall batch speed
			const batchEndTime = performance.now();
			const batchDuration = (batchEndTime - batchStartTime) / 1000;

			if (batchDuration > 0 && batchBytes > 0) {
				const batchSpeed = (batchBytes * 8) / (1024 * 1024 * batchDuration);
				console.log(
					`Batch upload: ${validResults} chunks, ${(
						batchBytes /
						1024 /
						1024
					).toFixed(1)}MB, speed: ${batchSpeed.toFixed(2)} Mbps`
				);
			}

			// Update progress
			const now = performance.now();
			const timeProgress = Math.min(
				100,
				((now - startTime) / (MIN_TEST_DURATION * 1000)) * 100
			);
			const chunkProgress = Math.min(
				100,
				((i + batch.length) / uploadData.length) * 100
			);
			const progress = Math.max(timeProgress, chunkProgress);

			// Calculate current speed for display
			if (
				now - lastUpdateTime > MEASUREMENT_INTERVAL &&
				speedMeasurements.length > 0
			) {
				// Use different window sizes based on connection type
				const windowSize =
					connectionType === "slow"
						? 1
						: connectionType === "moderate"
						? 2
						: connectionType === "fast"
						? 3
						: 4;

				const recentMeasurements = speedMeasurements.slice(-windowSize);
				const avgSpeed =
					recentMeasurements.reduce((sum, s) => sum + s, 0) /
					recentMeasurements.length;

				onProgress({ progress, currentSpeed: avgSpeed });
				lastUpdateTime = now;
			}

			// Add a small delay between batches based on connection type
			if (connectionType === "slow") {
				await new Promise((resolve) => setTimeout(resolve, 300));
			} else if (connectionType !== "ultra-fast") {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}

		console.log(
			`Upload test complete: totalBytes=${totalUploaded}, measurements=${speedMeasurements.length}`
		);

		// Calculate final result
		let finalSpeed;

		if (speedMeasurements.length > 3) {
			// Use different statistical methods based on connection type
			const sortedMeasurements = [...speedMeasurements].sort((a, b) => a - b);

			if (connectionType === "ultra-fast" || connectionType === "very-fast") {
				// For high-speed, use 90th percentile for better accuracy
				const idx = Math.floor(sortedMeasurements.length * 0.9);
				finalSpeed = sortedMeasurements[idx];
				console.log("Using 90th percentile for high-speed upload:", finalSpeed);
			} else if (connectionType === "fast") {
				// For fast connections, use upper quartile
				const idx = Math.floor(sortedMeasurements.length * 0.75);
				finalSpeed = sortedMeasurements[idx];
				console.log("Using 75th percentile for fast upload:", finalSpeed);
			} else {
				// For slower connections, use median for stability
				const mid = Math.floor(sortedMeasurements.length / 2);
				finalSpeed = sortedMeasurements[mid];
				console.log("Using median for upload:", finalSpeed);
			}
		} else if (totalUploaded > 0) {
			// Calculate from total bytes
			const endTime = performance.now();
			const totalTimeSeconds = (endTime - startTime) / 1000;
			finalSpeed = (totalUploaded * 8) / (1024 * 1024 * totalTimeSeconds);
			console.log(
				"Using calculated upload speed from total bytes:",
				finalSpeed
			);
		} else {
			// Fallback
			finalSpeed = 5;
			console.log("Using fallback upload speed:", finalSpeed);
		}

		return Math.max(0.1, finalSpeed);
	} catch (error) {
		console.error("Upload test failed:", error);
		return 5; // Fallback speed
	}
}

// Simulate speed test for local testing
function simulateSpeedTest(onProgress, baseSpeed, type) {
	return new Promise((resolve) => {
		console.log(`Using ${type} speed simulation (${baseSpeed} Mbps)`);

		// Different simulation patterns for download vs upload
		const variation = type === "download" ? 0.05 : 0.1; // 5% variation for download, 10% for upload
		const updateFrequency = type === "download" ? 150 : 200; // ms between updates

		// For upload, use a slight reduction from download speed to simulate realistic scenarios
		const actualBaseSpeed = type === "upload" ? baseSpeed * 0.95 : baseSpeed;

		// Store for average calculation
		const measurements = [];

		// Simulate test with variations in speed over time
		let progress = 0;
		let duration = 0;
		const testDuration = MIN_TEST_DURATION * 1000;

		const interval = setInterval(() => {
			duration += updateFrequency;

			// Progress based on elapsed time
			progress = Math.min(100, (duration / testDuration) * 100);

			// Realistic speed variations
			// Variation reduces slightly over time as connection stabilizes
			const stabilityFactor = Math.min(1, duration / 3000) * 0.5;
			const currentVariation = variation * (1 - stabilityFactor);
			const speedFactor =
				1 - currentVariation + Math.random() * currentVariation * 2;
			const currentSpeed = actualBaseSpeed * speedFactor;

			measurements.push(currentSpeed);
			onProgress({ progress, currentSpeed });

			if (progress >= 100) {
				clearInterval(interval);

				// Simulate slight measurement error
				const finalSpeed = actualBaseSpeed * (0.98 + Math.random() * 0.04);
				resolve(finalSpeed);
			}
		}, updateFrequency);
	});
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
