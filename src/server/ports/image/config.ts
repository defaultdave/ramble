import 'server-only';
import type { ImagePort } from './index';
import { createSharpImageAdapter } from './sharp';

/** The image adapter. There is one, so nothing in the environment chooses it. */
export function getImagePort(): ImagePort {
  return createSharpImageAdapter();
}
