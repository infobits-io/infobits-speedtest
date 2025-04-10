// app/api/testfile/route.ts

import { NextRequest, NextResponse } from "next/server";

// This is a custom handler for the streaming response
export async function GET(request: NextRequest) {
	// Parse size parameter (default to 100MB)
	const searchParams = request.nextUrl.searchParams;
	const sizeParam = searchParams.get("size");
	const size = sizeParam ? parseInt(sizeParam, 10) : 100 * 1024 * 1024;

	// Validate size (max 500MB to prevent abuse)
	const validSize = Math.min(size, 500 * 1024 * 1024);

	// Create a stream that generates random data
	const stream = new ReadableStream({
		start(controller) {
			let bytesRemaining = validSize;
			const chunkSize = 1024 * 1024; // 1MB chunks

			// Function to push chunks
			const pushChunk = () => {
				if (bytesRemaining <= 0) {
					controller.close();
					return;
				}

				const currentChunkSize = Math.min(chunkSize, bytesRemaining);
				const buffer = new Uint8Array(currentChunkSize);

				// Fill buffer with random data
				for (let i = 0; i < currentChunkSize; i++) {
					buffer[i] = Math.floor(Math.random() * 256);
				}

				controller.enqueue(buffer);
				bytesRemaining -= currentChunkSize;

				// Use setTimeout to avoid blocking the event loop
				setTimeout(pushChunk, 0);
			};

			// Start pushing chunks
			pushChunk();
		},
	});

	return new NextResponse(stream, {
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Length": validSize.toString(),
			"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
			Pragma: "no-cache",
		},
	});
}

export const dynamic = "force-dynamic";
