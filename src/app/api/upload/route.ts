// app/api/upload/route.ts

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
	try {
		// Get the request body as a Blob
		const blob = await request.blob();

		// Simulate processing the upload (we don't actually need to do anything with it)
		// In a real-world scenario, you might want to check the size, validate the content, etc.

		// Return a success response
		return NextResponse.json({ success: true, size: blob.size });
	} catch (error) {
		console.error("Upload error:", error);
		return NextResponse.json({ error: "Upload failed" }, { status: 500 });
	}
}

export const dynamic = "force-dynamic";
