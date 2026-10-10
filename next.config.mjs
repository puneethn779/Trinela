/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'kxtrlwlvaonswwpguhmb.supabase.co' },
    ],
  },
}

export default nextConfig
