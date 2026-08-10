import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The generated AGENTS.md/CLAUDE.md files are noise in a submitted repo.
  agentRules: false,
  // Fail the production build on a type error rather than shipping it.
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
};

export default nextConfig;
