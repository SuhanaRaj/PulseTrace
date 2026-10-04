import { randomBytes } from 'node:crypto';

// Short, URL-safe, collision-resistant IDs: tr_<16 hex> / sp_<12 hex>
export function generateTraceId() {
  return `tr_${randomBytes(8).toString('hex')}`;
}

export function generateSpanId() {
  return `sp_${randomBytes(6).toString('hex')}`;
}
