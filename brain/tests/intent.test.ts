import { describe, expect, it } from 'vitest';
import { routeIntent } from '../src/intent';
import { routeLocal } from '../src/local';
import { simRegistry } from '../bench/registry';

const reg = simRegistry();
const opts = { defaultRoom: 'bedroom' };
const route = (t: string) => routeIntent(t, reg, opts);
const light = (on: boolean) => ({ name: 'set_device', args: { device: 'livingroom/light', on } });
const plug = (on: boolean) => ({ name: 'set_device', args: { device: 'kitchen/plug', on } });
const sensor = (metric: string, room = 'bedroom') => ({ name: 'get_sensor', args: { metric, room } });

// Sentences the exact router does not take and that were not used to write the examples (brief 0018 §5).
describe('routeIntent: said differently or misheard', () => {
  it.each([
    ['phòng mỹ độ', [sensor('temp')]], // STT heard "phòng mấy độ" this way (brief 0009)
    ['mở cái đèn lên giùm', [light(true)]],
    ['tắt dùm cái ổ cắm trong bếp', [plug(false)]],
    ['độ ẩm trong phòng ngủ ra sao rồi', [sensor('humidity')]], // was read as temperature until word pairs were added
    ['cho mình biết độ ẩm phòng ngủ với', [sensor('humidity')]],
    ['không khí ngoài ban công có bí không', [sensor('co2', 'balcony')]],
    ['trong nhà có mấy thiết bị', [{ name: 'list_devices', args: {} }]],
    ['chuẩn bị đi ngủ thôi', [{ name: 'run_scene', args: { name: 'sleep' } }]],
    ['mình học bài 30 phút', [{ name: 'run_scene', args: { name: 'focus', minutes: 30 } }]],
    ['could you switch the lamp off for me', [light(false)]],
    ['is it humid in the bedroom today', [sensor('humidity')]],
    ['nhiet do phong ngu hom nay the nao roi', [sensor('temp')]],
    ['trời nóng quá, tắt đèn đi', [light(false)]],
  ])('%s', (text, want) => {
    expect(routeLocal(text, reg, opts)).toBeNull(); // otherwise this tier is not what is being tested
    expect(route(text)).toEqual(want);
  });
});

describe('routeIntent: never switches what was not asked', () => {
  it.each([
    'đừng bật đèn',
    'không cần tắt đèn đâu',
    'đèn có bật không',
    'đèn bật chưa',
    'bật đèn lúc 7 giờ',
    'bật đèn sau 10 phút',
    'nếu trời tối thì bật đèn',
    'tắt đèn khi tôi ra ngoài',
    'is the light on',
    'bật nhạc lên đi',
    'mở youtube cho mình',
    'bật quạt giúp mình',
    'mở cửa gara',
    'đèn thế nào',
    'phòng ngủ tối quá, bật đèn lên', // the only light is in the living room
    'bật đèn và kể chuyện cười',
    'kể cho mình nghe một câu chuyện',
    'cảm ơn nhiều nhé',
  ])('%s', (text) => {
    expect(route(text)).toBeNull();
  });

  it.each(['với cái nóng thế này mình có nên mặc áo khoác không', 'hôm qua nóng hơn hay hôm nay nóng hơn', 'tại sao phòng ngủ ẩm thế'])(
    'more than today\'s value is the LLM\'s: %s',
    (text) => expect(route(text)).toBeNull(),
  );

  it('feeling sleepy is not "go to sleep"', () => {
    expect(route('buồn ngủ quá')).toBeNull();
  });

  it('two plugs both called "ổ cắm" and no room: ambiguous, the LLM asks', () => {
    const r = simRegistry();
    r.apply('vega/bedroom/plug/meta', JSON.stringify({ v: 1, kind: 'esp8266', room_name: 'Bedroom', aliases: ['ổ cắm', 'ổ cắm phòng ngủ'], risk: 'high' }));
    r.apply('vega/bedroom/plug/state', JSON.stringify({ v: 1, on: false }));
    expect(routeIntent('tắt ổ cắm giúp mình nha', r, opts)).toBeNull();
    expect(routeIntent('tắt ổ cắm phòng ngủ giúp mình nha', r, opts)).toEqual([{ name: 'set_device', args: { device: 'bedroom/plug', on: false } }]);
  });

  it('"nó" is the device just talked about', () => {
    expect(routeIntent('ừ tắt nó giùm luôn đi', reg, { ...opts, recent: { devices: ['livingroom/light'], room: null } })).toEqual([light(false)]);
  });
});
