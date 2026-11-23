import jsQR from 'jsqr';
import type { FrameDecoder } from './useQrScanner.js';

export const defaultDecoder: FrameDecoder = (data, width, height) =>
  jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
