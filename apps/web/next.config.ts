import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: process.platform === 'win32' ? undefined : ('standalone' as const),
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
};

export default nextConfig;
