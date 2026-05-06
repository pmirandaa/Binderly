/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Tamagui's `@tamagui/core` ships ESM and uses platform-specific
  // extensions internally (`.web.ts` / `.native.ts`). Adding it to
  // `transpilePackages` lets Next.js's bundler resolve the web
  // variant correctly. `@binderly/ui` re-exports from
  // `@tamagui/core` so it lives here for the same reason.
  transpilePackages: ['@binderly/ui', '@tamagui/core', '@tamagui/input'],
  experimental: {
    optimizePackageImports: ['@binderly/ui', '@binderly/api-client'],
  },
  images: {
    // Card catalog images are served from R2 in production. Apps
    // add real prod hosts in their deployment env.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.binderly.app' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;
