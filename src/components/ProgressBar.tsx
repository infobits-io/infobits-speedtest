"use client";

// components/ProgressBar.tsx

import React from "react";
import styles from "@/styles/ProgressBar.module.css";

interface ProgressBarProps {
	progress: number;
	color?: string;
	height?: number;
	label?: string;
	showPercentage?: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
	progress,
	color = "#2563eb", // Default blue color
	height = 8,
	label,
	showPercentage = true,
}) => {
	// Ensure progress is between 0 and 100
	const normalizedProgress = Math.min(Math.max(progress, 0), 100);

	return (
		<div className={styles.progressBarContainer}>
			{label && <div className={styles.label}>{label}</div>}
			<div
				className={styles.progressBarTrack}
				style={{ height: `${height}px` }}
			>
				<div
					className={styles.progressBarFill}
					style={{
						width: `${normalizedProgress}%`,
						backgroundColor: color,
					}}
				/>
			</div>
			{showPercentage && (
				<div className={styles.percentage}>
					{Math.round(normalizedProgress)}%
				</div>
			)}
		</div>
	);
};

export default ProgressBar;
