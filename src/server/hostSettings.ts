import 'server-only';
import {
  hostSettingsResult,
  type HostSettingsResult,
} from '@/lib/hostSettings';
import { readHostSettings } from '@/server/db/hostSettings';
import { loadForHostArea } from './hostArea';

/** The settings of the host the request's caller owns. */
export function loadHostSettings(): Promise<HostSettingsResult> {
  return loadForHostArea(readHostSettings, hostSettingsResult);
}
