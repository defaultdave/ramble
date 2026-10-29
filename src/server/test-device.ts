import 'server-only';
import { deviceFrom, type Device } from './device';

/** A device for unit and database tests: the same label is the same device. */
export function testDevice(label = 'device-test'): Device {
  return deviceFrom(label, '203.0.113.7');
}
