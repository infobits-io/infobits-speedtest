"use client";

// components/ResultDisplay.tsx

import React from "react";
import { TestResult } from "@/types";
import styles from "@/styles/ResultDisplay.module.css";

interface ResultDisplayProps {
	result: TestResult;
	isVisible: boolean;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ result, isVisible }) => {
	if (!isVisible) return null;

	// Helper function to format speed with appropriate units
	const formatSpeed = (speed: number): string => {
		if (speed >= 1000) {
			return `${(speed / 1000).toFixed(2)} Gbps`;
		} else {
			return `${speed.toFixed(2)} Mbps`;
		}
	};

	// Helper function to get appropriate class for the speed
	const getSpeedClass = (speed: number): string => {
		if (speed >= 100) return styles.excellent;
		if (speed >= 50) return styles.good;
		if (speed >= 25) return styles.average;
		if (speed >= 10) return styles.belowAverage;
		return styles.poor;
	};

	// Helper function to format latency
	const formatLatency = (ms: number): string => {
		return `${ms.toFixed(1)} ms`;
	};

	// Helper function to get class for the latency
	const getLatencyClass = (ms: number): string => {
		if (ms < 20) return styles.excellent;
		if (ms < 50) return styles.good;
		if (ms < 100) return styles.average;
		if (ms < 150) return styles.belowAverage;
		return styles.poor;
	};

	return (
		<div className={styles.resultContainer}>
			<h2 className={styles.resultTitle}>Test Results</h2>

			<div className={styles.resultGrid}>
				<div className={styles.resultCard}>
					<div className={styles.resultLabel}>Download</div>
					<div
						className={`${styles.resultValue} ${getSpeedClass(
							result.downloadSpeed
						)}`}
					>
						{formatSpeed(result.downloadSpeed)}
					</div>
				</div>

				<div className={styles.resultCard}>
					<div className={styles.resultLabel}>Upload</div>
					<div
						className={`${styles.resultValue} ${getSpeedClass(
							result.uploadSpeed
						)}`}
					>
						{formatSpeed(result.uploadSpeed)}
					</div>
				</div>

				<div className={styles.resultCard}>
					<div className={styles.resultLabel}>Latency</div>
					<div
						className={`${styles.resultValue} ${getLatencyClass(
							result.latency
						)}`}
					>
						{formatLatency(result.latency)}
					</div>
				</div>

				<div className={styles.resultCard}>
					<div className={styles.resultLabel}>Jitter</div>
					<div
						className={`${styles.resultValue} ${getLatencyClass(
							result.jitter
						)}`}
					>
						{formatLatency(result.jitter)}
					</div>
				</div>
			</div>

			<div className={styles.infoText}>
				<p>
					<strong>What do these results mean?</strong>
				</p>
				<p>
					<strong>Download:</strong> Speed at which data is transferred from the
					internet to your device.
					<br />
					<strong>Upload:</strong> Speed at which data is transferred from your
					device to the internet.
					<br />
					<strong>Latency:</strong> Time it takes for data to travel from your
					device to the server and back.
					<br />
					<strong>Jitter:</strong> Variation in latency over time.
				</p>
			</div>
		</div>
	);
};

export default ResultDisplay;
