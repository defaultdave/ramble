import { describe, expect, it } from 'vitest';
import {
  BEACON_PATH_PREFIX,
  beaconEdgeRule,
  beaconEdgeRuleCommand,
  beaconPaths,
} from './edgeRule';

describe('beacon edge rule', () => {
  it.each(beaconPaths)('covers %s with the one shared prefix', (path) => {
    expect(path.startsWith(BEACON_PATH_PREFIX)).toBe(true);
    expect(path.slice(BEACON_PATH_PREFIX.length)).toMatch(/^[a-z]+$/);
  });

  it('names exactly the two beacons design doc 3.2 lists', () => {
    expect(beaconPaths).toEqual(['/api/beacon/events', '/api/beacon/vitals']);
  });

  it('prints one command that matches the prefix and the limits', () => {
    const command = beaconEdgeRuleCommand();

    expect(command).toContain(
      `--condition '{"type":"path","op":"pre","value":"/api/beacon/"}'`,
    );
    expect(command).toContain('--action rate_limit');
    expect(command).toContain(
      `--rate-limit-window ${String(beaconEdgeRule.windowSeconds)}`,
    );
    expect(command).toContain(
      `--rate-limit-requests ${String(beaconEdgeRule.requests)}`,
    );
    expect(command).toContain('--rate-limit-keys ip');
    expect(command.match(/vercel firewall rules add/g)).toHaveLength(1);
  });

  it('stays inside the limits the firewall accepts', () => {
    expect(beaconEdgeRule.windowSeconds).toBeGreaterThanOrEqual(10);
    expect(beaconEdgeRule.windowSeconds).toBeLessThanOrEqual(3600);
    expect(beaconEdgeRule.requests).toBeGreaterThanOrEqual(1);
  });
});
