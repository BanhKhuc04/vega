import { describe, expect, it } from 'vitest';
import { deviceTopic, parseDeviceTopic, UI_SCENE } from '../src';

describe('topics', () => {
  it('builds and parses device topics', () => {
    expect(deviceTopic('bedroom', 'sensor', 'state')).toBe('vega/bedroom/sensor/state');
    expect(parseDeviceTopic('vega/bedroom/sensor/state')).toEqual({ room: 'bedroom', deviceId: 'sensor', leaf: 'state' });
    expect(parseDeviceTopic('vega/desk/core/availability')).toMatchObject({ leaf: 'availability' });
    expect(parseDeviceTopic('vega/livingroom/light/set')).toMatchObject({ leaf: 'set' });
  });
  it.each([
    'vega/system/events',
    'vega/ui/scene',
    'vega/system/pi/state', // reserved room
    'vega/ui/x/state',
    'vega/a/b',
    'vega/a/b/c/d',
    'vega/a/b/other',
    'vega/Bed Room/b/state',
    'other/a/b/state',
    '',
  ])('rejects %s', (t) => expect(parseDeviceTopic(t)).toBeNull());
  it('exposes the scene topic', () => expect(UI_SCENE).toBe('vega/ui/scene'));
});
