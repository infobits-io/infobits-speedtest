export type TestStatus = "idle" | "download" | "upload" | "complete";

export interface TestResult {
	downloadSpeed: number;
	uploadSpeed: number;
	latency: number;
	jitter: number;
}

export interface ProgressData {
	progress: number;
	currentSpeed: number;
}
