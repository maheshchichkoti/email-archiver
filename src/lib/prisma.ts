import { PrismaClient } from "@prisma/client";

// This prevents multiple instances of Prisma Client in development due to hot reloading
// In production, this isn't strictly necessary if your module system caches correctly,
// but it's a good defensive pattern.
declare global {
  // allow global `var` declarations
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    // Optional: Add logging configuration for Prisma if needed for debugging
    // log: ['query', 'info', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
