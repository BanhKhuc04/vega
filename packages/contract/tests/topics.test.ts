import { describe, expect, it } from 'vitest';
import { DASHBOARD_SUBSCRIPTIONS, deviceTopic, eventTopic, isEventsTopic, parseDeviceTopic, UI_SCENE } from '../src';

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
  it('event topics: the stream and one retained slot per type', () => {
    expect(eventTopic('ci')).toBe('vega/system/events/ci');
    for (const t of ['vega/system/events', 'vega/system/events/ci', 'vega/system/events/next_event']) expect(isEventsTopic(t), t).toBe(true);
    for (const t of ['vega/system/events/', 'vega/system/events/a/b', 'vega/system/eventsx', 'vega/system/pi', 'vega/ui/scene']) expect(isEventsTopic(t), t).toBe(false);
    expect(DASHBOARD_SUBSCRIPTIONS).toContain('vega/system/events/+');
  });
  it('exposes the scene topic', () => expect(UI_SCENE).toBe('vega/ui/scene'));
});
