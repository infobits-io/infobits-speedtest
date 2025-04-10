// utils/speedTestUtils.ts

import { ProgressData, TestResult, TestStatus } from "../types";

// Size of test file in bytes (default: 100MB)
const TEST_FILE_SIZE = 100 * 1024 * 1024;
// Default chunk size for upload (1MB)
const UPLOAD_CHUNK_SIZE = 1 * 1024 * 1024;
// Number of ping tests to run
const PING_TESTS = 10;

// Function to measure latency
export const measureLatency = async (): Promise<{
	latency: number;
	jitter: number;
}> => {
	const pingResults: number[] = [];

	for (let i = 0; i < PING_TESTS; i++) {
		const startTime = performance.now();
		try {
			// Add a random parameter to prevent caching
			await fetch(`/api/ping?t=${Date.now()}`, { method: "GET" });
			const endTime = performance.now();
			pingResults.push(endTime - startTime);
		} catch (error) {
			console.error("Ping test failed:", error);
		}

		// Small delay between tests
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	// Calculate average latency
	const latency =
		pingResults.length > 0
			? pingResults.reduce((sum, time) => sum + time, 0) / pingResults.length
			: 0;

	// Calculate jitter (average deviation from the mean)
	const jitter =
		pingResults.length > 0
			? pingResults.reduce((sum, time) => sum + Math.abs(time - latency), 0) /
			  pingResults.length
			: 0;

	return { latency, jitter };
};

// Function to measure download speed
export const measureDownloadSpeed = async (
	onProgress: (data: ProgressData) => void
): Promise<number> => {
	const url = `/api/testfile?size=${TEST_FILE_SIZE}&t=${Date.now()}`;
	const startTime = performance.now();
	let lastProgress = 0;
	let lastTime = startTime;
	let totalBytes = 0;

	try {
		const response = await fetch(url);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Response body is null");

		// Get content length if available
		const contentLength =
			parseInt(response.headers.get("Content-Length") || "0", 10) ||
			TEST_FILE_SIZE;

		while (true) {
			const { done, value } = await reader.read();

			if (done) break;

			// Update bytes received
			totalBytes += value.length;

			// Calculate progress
			const progress = (totalBytes / contentLength) * 100;

			// Calculate current speed every ~10% or at least 500ms
			const currentTime = performance.now();
			if (progress - lastProgress > 10 || currentTime - lastTime > 500) {
				const timeDiff = (currentTime - lastTime) / 1000; // convert to seconds
				const chunkBytes = totalBytes - (lastProgress / 100) * contentLength;
				const currentSpeed = (chunkBytes * 8) / (1024 * 1024 * timeDiff); // Convert to Mbps

				onProgress({ progress, currentSpeed });
				lastProgress = progress;
				lastTime = currentTime;
			}
		}

		const endTime = performance.now();
		const totalTime = (endTime - startTime) / 1000; // convert to seconds

		// Convert bytes to bits and calculate speed in Mbps
		const speedMbps = (totalBytes * 8) / (1024 * 1024 * totalTime);

		return speedMbps;
	} catch (error) {
		console.error("Download test failed:", error);
		return 0;
	}
};

// Function to measure upload speed
export const measureUploadSpeed = async (
	onProgress: (data: ProgressData) => void
): Promise<number> => {
	const startTime = performance.now();
	let totalBytes = 0;
	let lastProgress = 0;
	let lastTime = startTime;

	try {
		// Create random data to upload
		const chunkCount = Math.ceil(TEST_FILE_SIZE / UPLOAD_CHUNK_SIZE);
		const testData = new Uint8Array(UPLOAD_CHUNK_SIZE).fill(0xff);

		for (let i = 0; i < chunkCount; i++) {
			//const chunkStartTime = performance.now();

			// Upload chunk
			await fetch("/api/upload", {
				method: "POST",
				headers: {
					"Content-Type": "application/octet-stream",
				},
				body: testData,
			});

			totalBytes += testData.length;

			// Calculate progress
			const progress = (totalBytes / TEST_FILE_SIZE) * 100;

			// Calculate current speed
			const currentTime = performance.now();
			if (progress - lastProgress > 10 || currentTime - lastTime > 500) {
				const timeDiff = (currentTime - lastTime) / 1000; // convert to seconds
				const chunkBytes = totalBytes - (lastProgress / 100) * TEST_FILE_SIZE;
				const currentSpeed = (chunkBytes * 8) / (1024 * 1024 * timeDiff); // Convert to Mbps

				onProgress({ progress, currentSpeed });
				lastProgress = progress;
				lastTime = currentTime;
			}

			// Check if we should break early for user experience
			if (i >= 5 && (performance.now() - startTime) / 1000 > 8) {
				// We have enough data for a good estimate
				break;
			}
		}

		const endTime = performance.now();
		const totalTime = (endTime - startTime) / 1000; // convert to seconds

		// Convert bytes to bits and calculate speed in Mbps
		const speedMbps = (totalBytes * 8) / (1024 * 1024 * totalTime);

		return speedMbps;
	} catch (error) {
		console.error("Upload test failed:", error);
		return 0;
	}
};

// Run complete test suite
export const runSpeedTest = async (
	onProgress: (status: TestStatus, data?: ProgressData) => void
): Promise<TestResult> => {
	// Initial result
	const result: TestResult = {
		downloadSpeed: 0,
		uploadSpeed: 0,
		latency: 0,
		jitter: 0,
	};

	// Measure latency
	onProgress("idle");
	const latencyResult = await measureLatency();
	result.latency = latencyResult.latency;
	result.jitter = latencyResult.jitter;

	// Measure download speed
	onProgress("download");
	result.downloadSpeed = await measureDownloadSpeed((data) => {
		onProgress("download", data);
	});

	// Measure upload speed
	onProgress("upload");
	result.uploadSpeed = await measureUploadSpeed((data) => {
		onProgress("upload", data);
	});

	// Complete
	onProgress("complete");

	return result;
};
