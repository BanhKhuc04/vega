import { describe, expect, it } from 'vitest';
import { routeLocal } from '../src/local';
import { fold, clip } from '../src/text';
import { simRegistry } from './fixtures';

const reg = simRegistry();
const route = (t: string) => routeLocal(t, reg, { defaultRoom: 'bedroom' });

describe('fold / clip', () => {
  it('folds Vietnamese and symbols', () => {
    expect(fold('Phòng mấy ĐỘ, bật đèn giúp?')).toBe('phong may do bat den giup');
    expect(fold('CO₂ thế nào')).toBe('co2 the nao');
  });
  it('clips on a word boundary', () => {
    expect(clip('short', 80)).toBe('short');
    expect(clip('one two three four five six', 12)).toBe('one two…');
  });
});

describe('routeLocal', () => {
  it('the milestone sentence: temperature + light, two tools, no LLM', () => {
    expect(route('phòng mấy độ, bật đèn giúp')).toEqual([
      { name: 'get_sensor', args: { metric: 'temp', room: 'bedroom' } },
      { name: 'set_device', args: { device: 'livingroom/light', on: true } },
    ]);
  });

  it.each([
    ['tắt đèn', [{ name: 'set_device', args: { device: 'livingroom/light', on: false } }]],
    ['Vega ơi, mở đèn phòng khách nhé', [{ name: 'set_device', args: { device: 'livingroom/light', on: true } }]],
    ['turn on the light', [{ name: 'set_device', args: { device: 'livingroom/light', on: true } }]],
    ['làm ơn bật đèn', [{ name: 'set_device', args: { device: 'livingroom/light', on: true } }]],
    ['bật đèn và ổ cắm', [{ name: 'set_device', args: { device: 'livingroom/light', on: true } }, { name: 'set_device', args: { device: 'kitchen/plug', on: true } }]],
    ['độ ẩm bao nhiêu', [{ name: 'get_sensor', args: { metric: 'humidity', room: 'bedroom' } }]],
    ['ban công nóng không', [{ name: 'get_sensor', args: { metric: 'temp', room: 'balcony' } }]],
    ['CO₂ phòng ngủ thế nào', [{ name: 'get_sensor', args: { metric: 'co2', room: 'bedroom' } }]],
    ['how warm is it in the balcony', [{ name: 'get_sensor', args: { metric: 'temp', room: 'balcony' } }]],
    ['đi ngủ thôi', [{ name: 'run_scene', args: { name: 'sleep' } }]],
    ['chế độ tập trung', [{ name: 'run_scene', args: { name: 'focus' } }]],
    ['có những thiết bị nào', [{ name: 'list_devices', args: {} }]],
    ['tắt hết thiết bị', [{ name: 'set_device', args: { device: 'kitchen/plug', on: false } }, { name: 'set_device', args: { device: 'livingroom/light', on: false } }]],
  ])('%s', (text, calls) => expect(route(text)).toEqual(calls));

  it.each([
    'đừng bật đèn', // negation
    'bật đèn sau 5 phút', // a time it cannot honour
    'đèn bật không', // a question, not an order
    'bật tắt đèn', // contradiction
    'bật quạt', // no such device
    'bật', // no device
    'kể chuyện cười đi', // not a device command at all
    'phòng mấy độ, rồi viết email cho sếp', // one clause it does not understand
    '',
    '   ,,, ',
  ])('leaves %j to the LLM', (text) => expect(route(text)).toBeNull());

  it('ambiguous devices go to the LLM, a room makes them precise', () => {
    const r = simRegistry();
    r.apply('vega/bedroom/lamp/meta', JSON.stringify({ v: 1, kind: 'esp8266', room_name: 'Bedroom', aliases: ['đèn'], risk: 'low' }));
    r.apply('vega/bedroom/lamp/state', JSON.stringify({ v: 1, on: false }));
    expect(routeLocal('bật đèn', r, { defaultRoom: 'bedroom' })).toBeNull();
    expect(routeLocal('bật đèn phòng ngủ', r, { defaultRoom: 'bedroom' })).toEqual([{ name: 'set_device', args: { device: 'bedroom/lamp', on: true } }]);
  });

  it('a new device is understood from its meta alone', () => {
    const r = simRegistry();
    r.apply('vega/bedroom/fan/meta', JSON.stringify({ v: 1, kind: 'esp8266', room_name: 'Bedroom', aliases: ['quạt', 'fan'], risk: 'low' }));
    r.apply('vega/bedroom/fan/state', JSON.stringify({ v: 1, on: false }));
    expect(routeLocal('bật quạt', r, { defaultRoom: 'bedroom' })).toEqual([{ name: 'set_device', args: { device: 'bedroom/fan', on: true } }]);
  });
});
