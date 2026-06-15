/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native/engine-backed packages out of the server bundle so they load
  // as real Node modules at runtime (required for the libSQL driver adapter).
  experimental: {
    serverComponentsExternalPackages: [
      '@prisma/client',
      '@prisma/adapter-libsql',
      '@libsql/client',
      '@adobe/pdfservices-node-sdk',
    ],
  },
}

module.exports = nextConfig
