-- Retain COINGECKO and every existing cache row; new observations have a distinct identity.
ALTER TYPE "Provider" ADD VALUE IF NOT EXISTS 'COINPAPRIKA';
