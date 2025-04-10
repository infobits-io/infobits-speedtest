"use client";

// components/SpeedTest.tsx

import React, { useState, useCallback } from "react";
import { TestResult, TestStatus, ProgressData } from "@/types";
import ProgressBar from "./ProgressBar";
import ResultDisplay from "./ResultDisplay";
import { runSpeedTest } from "@/utils/speedTestUtils";
import styles from "@/styles/SpeedTest.module.css";

const SpeedTest: React.FC = () => {
	const [testStatus, setTestStatus] = useState<TestStatus>("idle");
	const [progress, setProgress] = useState<number>(0);
	const [currentSpeed, setCurrentSpeed] = useState<number>(0);
	const [testResult, setTestResult] = useState<TestResult>({
		downloadSpeed: 0,
		uploadSpeed: 0,
		latency: 0,
		jitter: 0,
	});
	const [isRunning, setIsRunning] = useState<boolean>(false);
	const [showResults, setShowResults] = useState<boolean>(false);

	// Function to handle progress updates
	const handleProgress = useCallback(
		(status: TestStatus, data?: ProgressData) => {
			setTestStatus(status);

			if (data) {
				setProgress(data.progress);
				setCurrentSpeed(data.currentSpeed);
			} else {
				setProgress(0);
				setCurrentSpeed(0);
			}
		},
		[]
	);

	// Function to start the speed test
	const startTest = useCallback(async () => {
		if (isRunning) return;

		setIsRunning(true);
		setShowResults(false);
		setProgress(0);
		setCurrentSpeed(0);

		try {
			const result = await runSpeedTest(handleProgress);
			setTestResult(result);
			setShowResults(true);
		} catch (error) {
			console.error("Speed test failed:", error);
		} finally {
			setIsRunning(false);
		}
	}, [isRunning, handleProgress]);

	// Get label text based on current status
	const getStatusLabel = (): string => {
		switch (testStatus) {
			case "download":
				return "Testing Download Speed...";
			case "upload":
				return "Testing Upload Speed...";
			case "complete":
				return "Test Complete";
			default:
				return "Preparing Test...";
		}
	};

	// Get appropriate color for progress bar
	const getProgressColor = (): string => {
		switch (testStatus) {
			case "download":
				return "#2563eb"; // Blue
			case "upload":
				return "#7c3aed"; // Purple
			default:
				return "#6b7280"; // Gray
		}
	};

	// Function to format current speed
	const formatCurrentSpeed = (): string => {
		if (currentSpeed === 0) return "";

		return currentSpeed >= 1000
			? `${(currentSpeed / 1000).toFixed(2)} Gbps`
			: `${currentSpeed.toFixed(2)} Mbps`;
	};

	return (
		<div className={styles.container}>
			<div className={styles.card}>
				<h1 className={styles.title}>NextJS Speed Test</h1>

				<div className={styles.speedMeter}>
					<div className={styles.gauge}>
						{isRunning && (
							<div className={styles.gaugeValue}>
								<span className={styles.speedValue}>
									{formatCurrentSpeed()}
								</span>
								{testStatus === "download" && (
									<span className={styles.speedUnit}>Download</span>
								)}
								{testStatus === "upload" && (
									<span className={styles.speedUnit}>Upload</span>
								)}
							</div>
						)}
						{!isRunning && !showResults && (
							<div className={styles.startIcon}>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
									/>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</div>
						)}
					</div>
				</div>

				{isRunning && (
					<div className={styles.progressSection}>
						<div className={styles.statusLabel}>{getStatusLabel()}</div>
						<ProgressBar
							progress={progress}
							color={getProgressColor()}
							height={12}
						/>
						{currentSpeed > 0 && (
							<div className={styles.currentSpeed}>{formatCurrentSpeed()}</div>
						)}
					</div>
				)}

				<div className={styles.actionSection}>
					<button
						className={`${styles.startButton} ${
							isRunning ? styles.disabled : ""
						}`}
						onClick={startTest}
						disabled={isRunning}
					>
						{isRunning ? "Running Test..." : "Start Speed Test"}
					</button>

					<div className={styles.infoText}>
						{!isRunning && !showResults && (
							<p>Click the button to test your internet connection speed.</p>
						)}
					</div>
				</div>
			</div>

			{showResults && (
				<ResultDisplay result={testResult} isVisible={showResults} />
			)}

			<footer className={styles.footer}>
				<p>Modern Speed Test built with Next.js and TypeScript</p>
				<p>Measures download, upload, latency, and jitter</p>
			</footer>
		</div>
	);
};

export default SpeedTest;
