// app/api/ping/route.ts

import { NextResponse } from "next/server";

export async function GET() {
	// Return an empty response immediately for ping test
	return new NextResponse(null, { status: 200 });
}
