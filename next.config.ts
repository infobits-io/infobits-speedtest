import { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	swcMinify: true,
	output: "standalone",
	// Configure for large data transfers in API routes
	experimental: {
		serverComponentsExternalPackages: [],
		serverActions: {
			bodySizeLimit: "500mb",
		},
	},
};

export default nextConfig;
