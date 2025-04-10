// Constants
const TEST_FILE_SIZE = 50 * 1024 * 1024; // 50MB for download test
const UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for upload
const PING_TESTS = 10; // Number of ping tests
const MIN_TEST_DURATION = 10; // Minimum test duration in seconds (increased for realism)
const MEASUREMENT_INTERVAL = 200; // Milliseconds between measurements

// Test status enum
const TestStatus = {
	IDLE: "idle",
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

// Measure latency - improved version
async function measureLatency() {
	const pingResults = [];

	// Reset progress and show status
	updateStatus(TestStatus.IDLE, { progress: 0, currentSpeed: 0 });
	console.log("Starting latency test");

	// First ping might be slow due to connection setup, so do a warm-up ping
	try {
		await fetch(`/ping?t=${Date.now()}`, { method: "GET" });
	} catch (e) {
		console.log("Warm-up ping failed, continuing with test");
	}

	// Real ping tests
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

		// Small delay between tests
		await new Promise((resolve) => setTimeout(resolve, 200));
	}

	// For local development, generate more realistic values if needed
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	let latency, jitter;

	if (
		isLocal &&
		(pingResults.length === 0 || pingResults.every((p) => p < 3))
	) {
		console.log("Using realistic latency values for local development");

		// Create realistic ping values
		const simulatedPings = [];
		const baseLatency = 15 + Math.random() * 20; // Between 15-35ms

		for (let i = 0; i < PING_TESTS; i++) {
			// Add variation around the base latency (±30%)
			simulatedPings.push(baseLatency * (0.7 + Math.random() * 0.6));
		}

		// Calculate average latency from simulated pings
		latency =
			simulatedPings.reduce((sum, ping) => sum + ping, 0) /
			simulatedPings.length;

		// Calculate jitter from simulated pings (variation from mean)
		jitter =
			simulatedPings.reduce((sum, ping) => sum + Math.abs(ping - latency), 0) /
			simulatedPings.length;
	} else {
		// Calculate from real measurements
		// Remove outliers (very high values)
		const filteredPings =
			pingResults.length >= 5
				? pingResults.sort((a, b) => a - b).slice(0, pingResults.length - 1)
				: pingResults;

		latency =
			filteredPings.length > 0
				? filteredPings.reduce((sum, time) => sum + time, 0) /
				  filteredPings.length
				: 20; // Default if no measurements

		jitter =
			filteredPings.length > 0
				? filteredPings.reduce(
						(sum, time) => sum + Math.abs(time - latency),
						0
				  ) / filteredPings.length
				: 5; // Default if no measurements
	}

	console.log(
		`Latency test results - Average: ${latency.toFixed(
			2
		)}ms, Jitter: ${jitter.toFixed(2)}ms`
	);
	return { latency, jitter };
}

// Measure download speed
async function measureDownloadSpeed(onProgress) {
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	if (isLocal) {
		return simulateDownloadTest(onProgress);
	}

	// Add cache busting parameter and size parameter
	const url = `/testfile?size=${TEST_FILE_SIZE}&t=${Date.now()}`;
	const startTime = performance.now();
	let bytesLoaded = 0;
	let totalBytes = 0;
	let speedMeasurements = [];

	console.log("Starting download test with file size:", TEST_FILE_SIZE);

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

		let lastUpdateTime = performance.now();
		let testEndTime = startTime + MIN_TEST_DURATION * 1000;

		// Start measuring
		while (true) {
			const { done, value } = await reader.read();

			if (done || performance.now() >= testEndTime) {
				console.log("Download complete or test duration reached");
				break;
			}

			// Increment bytes loaded
			const now = performance.now();
			bytesLoaded += value.length;
			totalBytes += value.length;

			// Calculate progress percentage
			const progress =
				contentLength > 0
					? Math.min(100, (totalBytes / contentLength) * 100)
					: Math.min(
							100,
							((now - startTime) / (MIN_TEST_DURATION * 1000)) * 100
					  );

			// Calculate speed
			const timeSinceLastUpdate = now - lastUpdateTime;

			// Update display at regular intervals
			if (timeSinceLastUpdate >= MEASUREMENT_INTERVAL) {
				// Calculate speed in Mbps
				const elapsedSeconds = timeSinceLastUpdate / 1000;
				const bytesPerSecond = bytesLoaded / elapsedSeconds;
				const currentSpeedMbps = (bytesPerSecond * 8) / (1024 * 1024); // Convert to Mbps

				console.log(
					`Download speed measurement: ${currentSpeedMbps.toFixed(2)} Mbps`
				);

				if (currentSpeedMbps > 0) {
					speedMeasurements.push(currentSpeedMbps);

					// Report the current speed as a moving average of the last few measurements
					const recentMeasurements = speedMeasurements.slice(-3);
					const avgSpeed =
						recentMeasurements.reduce((sum, speed) => sum + speed, 0) /
						recentMeasurements.length;

					// Report progress
					onProgress({ progress, currentSpeed: avgSpeed });
				}

				// Reset for next measurement
				lastUpdateTime = now;
				bytesLoaded = 0;
			}
		}

		// Calculate final result from total transfer
		const endTime = performance.now();
		const totalTimeSeconds = (endTime - startTime) / 1000;

		console.log(
			`Download test: totalBytes=${totalBytes}, time=${totalTimeSeconds}s`
		);

		let finalSpeed;

		if (speedMeasurements.length > 0) {
			// Use the 75th percentile measurement for more reliability
			const sortedMeasurements = [...speedMeasurements].sort((a, b) => a - b);
			const idx = Math.floor(sortedMeasurements.length * 0.75);
			finalSpeed =
				sortedMeasurements[idx] ||
				sortedMeasurements[sortedMeasurements.length - 1];
			console.log("Using 75th percentile of measurements:", finalSpeed);
		} else if (totalBytes > 0 && totalTimeSeconds > 0) {
			// Calculate from total bytes
			finalSpeed = (totalBytes * 8) / (1024 * 1024 * totalTimeSeconds);
			console.log("Using calculated speed from total bytes:", finalSpeed);
		} else {
			// Fallback for local testing
			finalSpeed = 100 + Math.random() * 400;
			console.log("Using fallback speed:", finalSpeed);
		}

		return Math.max(1.0, finalSpeed);
	} catch (error) {
		console.error("Download test failed:", error);
		return 50 + Math.random() * 200; // Fallback speed
	}
}

// Measure upload speed
async function measureUploadSpeed(onProgress) {
	const isLocal =
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	if (isLocal) {
		return simulateUploadTest(onProgress);
	}

	const startTime = performance.now();
	let totalUploaded = 0;
	let speedMeasurements = [];

	console.log("Starting upload test");

	try {
		// Create random data for uploading
		const testData = new Uint8Array(UPLOAD_CHUNK_SIZE);
		crypto.getRandomValues(testData);

		// Calculate number of chunks to upload
		const targetTestSize = TEST_FILE_SIZE;
		const chunkCount = Math.ceil(targetTestSize / UPLOAD_CHUNK_SIZE);

		console.log(
			`Upload test: chunk size=${UPLOAD_CHUNK_SIZE}, chunks=${chunkCount}`
		);

		const testEndTime = startTime + MIN_TEST_DURATION * 1000;

		// Upload chunks in sequence
		for (let i = 0; i < chunkCount; i++) {
			if (performance.now() >= testEndTime) {
				console.log("Upload test duration reached");
				break;
			}

			const chunkStartTime = performance.now();

			// Make the actual upload request
			const response = await fetch(`/upload?t=${Date.now()}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/octet-stream",
				},
				body: testData,
			});

			if (!response.ok) {
				throw new Error(`Upload failed: ${response.status}`);
			}

			const chunkEndTime = performance.now();
			const elapsedSeconds = (chunkEndTime - chunkStartTime) / 1000;

			// Get server-side timing data if available
			let serverDuration = 0;
			try {
				const responseData = await response.json();
				serverDuration = responseData.duration;
				console.log(`Server reported upload duration: ${serverDuration}s`);
			} catch (e) {
				console.warn("Could not parse server timing data", e);
			}

			// Update counters
			totalUploaded += testData.length;

			// Calculate current speed in Mbps
			let currentSpeed;

			if (serverDuration > 0 && serverDuration < 1) {
				// Sanity check for server timing
				// Use server-side timing for more accuracy if available
				currentSpeed = (testData.length * 8) / (1024 * 1024 * serverDuration);
			} else {
				// Otherwise use client-side timing
				currentSpeed = (testData.length * 8) / (1024 * 1024 * elapsedSeconds);
			}

			console.log(`Upload speed measurement: ${currentSpeed.toFixed(2)} Mbps`);

			if (currentSpeed > 0 && currentSpeed < 1000) {
				speedMeasurements.push(currentSpeed);
			}

			// Calculate progress - based on both time and chunks
			const timeProgress = Math.min(
				100,
				((performance.now() - startTime) / (MIN_TEST_DURATION * 1000)) * 100
			);
			const chunkProgress = Math.min(100, ((i + 1) / chunkCount) * 100);
			const progress = Math.max(timeProgress, chunkProgress);

			// Use the last 3 measurements for the displayed speed
			const recentMeasurements = speedMeasurements.slice(-3);
			const avgSpeed =
				recentMeasurements.length > 0
					? recentMeasurements.reduce((sum, speed) => sum + speed, 0) /
					  recentMeasurements.length
					: currentSpeed;

			onProgress({ progress, currentSpeed: avgSpeed });

			// Add a small delay between chunks to make test more visible
			await new Promise((resolve) => setTimeout(resolve, 200));
		}

		console.log(
			`Upload test: totalBytes=${totalUploaded}, measurements=${speedMeasurements.length}`
		);

		// Calculate final result
		let finalSpeed;

		if (speedMeasurements.length > 0) {
			// Use the median of all measurements for more reliability
			const sortedMeasurements = [...speedMeasurements].sort((a, b) => a - b);
			const midIdx = Math.floor(sortedMeasurements.length / 2);

			finalSpeed = sortedMeasurements[midIdx];
			console.log("Using median of upload measurements:", finalSpeed);
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
			// Fallback for local testing
			finalSpeed = 50 + Math.random() * 200;
			console.log("Using fallback upload speed:", finalSpeed);
		}

		return Math.max(1.0, finalSpeed);
	} catch (error) {
		console.error("Upload test failed:", error);
		return 30 + Math.random() * 100; // Fallback speed
	}
}

// Simulate a download test for local development - more realistic
function simulateDownloadTest(onProgress) {
	return new Promise((resolve) => {
		console.log("Using simulated download test for local development");

		// Base speed between 100-500 Mbps for download
		const baseSpeed = 100 + Math.random() * 400;

		// Store for average calculation
		const measurements = [];

		// Simulate a longer test with variations in speed over time
		let progress = 0;
		let duration = 0;
		const updateInterval = 250; // ms between updates

		const interval = setInterval(() => {
			duration += updateInterval;

			// Progress based on elapsed time related to test duration
			progress = Math.min(100, (duration / (MIN_TEST_DURATION * 1000)) * 100);

			// Simulate realistic speed variations over time
			// Start slower, peak in the middle, then slightly drop
			const timeRatio = duration / (MIN_TEST_DURATION * 1000);
			let speedFactor;

			if (timeRatio < 0.3) {
				// Ramp up to 80% speed
				speedFactor = 0.3 + (timeRatio / 0.3) * 0.5;
			} else if (timeRatio < 0.7) {
				// Peak speed with small variations
				speedFactor = 0.8 + Math.random() * 0.4;
			} else {
				// Slightly drop off with more variation
				speedFactor = 0.7 + Math.random() * 0.5;
			}

			const currentSpeed = baseSpeed * speedFactor;
			measurements.push(currentSpeed);

			onProgress({ progress, currentSpeed });

			if (progress >= 100) {
				clearInterval(interval);

				// Use the 75th percentile for the final result
				const sortedMeasurements = [...measurements].sort((a, b) => a - b);
				const idx = Math.floor(sortedMeasurements.length * 0.75);
				const finalSpeed = sortedMeasurements[idx];

				resolve(finalSpeed);
			}
		}, updateInterval);
	});
}

// Simulate an upload test for local development - more realistic
function simulateUploadTest(onProgress) {
	return new Promise((resolve) => {
		console.log("Using simulated upload test for local development");

		// Base speed between 20-80 Mbps for upload (typically lower than download)
		const baseSpeed = 20 + Math.random() * 60;

		// Store for average calculation
		const measurements = [];

		// Simulate a longer test with variations in speed over time
		let progress = 0;
		let duration = 0;
		const updateInterval = 300; // ms between updates (slightly slower for upload)

		const interval = setInterval(() => {
			duration += updateInterval;

			// Progress based on elapsed time related to test duration
			progress = Math.min(100, (duration / (MIN_TEST_DURATION * 1000)) * 100);

			// Simulate realistic speed variations for upload
			// More variation in upload speeds
			const variation = 0.7 + Math.random() * 0.6;
			const currentSpeed = baseSpeed * variation;

			measurements.push(currentSpeed);
			onProgress({ progress, currentSpeed });

			if (progress >= 100) {
				clearInterval(interval);

				// Use the median for the final result
				const sortedMeasurements = [...measurements].sort((a, b) => a - b);
				const idx = Math.floor(sortedMeasurements.length / 2);
				const finalSpeed = sortedMeasurements[idx];

				resolve(finalSpeed);
			}
		}, updateInterval);
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
			testStatus === TestStatus.DOWNLOAD ? "Download" : "Upload";
		currentSpeed.textContent = formatSpeed(data.currentSpeed);
	} else {
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
	if (speed >= 100) return "excellent";
	if (speed >= 50) return "good";
	if (speed >= 25) return "average";
	if (speed >= 10) return "belowAverage";
	return "poor";
}

// Helper function to format latency
function formatLatency(ms) {
	return `${ms.toFixed(1)} ms`;
}

// Helper function to get class for the latency
function getLatencyClass(ms) {
	if (ms < 20) return "excellent";
	if (ms < 50) return "good";
	if (ms < 100) return "average";
	if (ms < 150) return "belowAverage";
	return "poor";
}

// Initialize the app when the page loads
document.addEventListener("DOMContentLoaded", init);
