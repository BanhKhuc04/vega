import { describe, expect, it } from 'vitest';
import { parseReminder } from '../src/remind';

// Thursday 19 Nov 2026, 14:05 local time
const NOW = new Date(2026, 10, 19, 14, 5).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const p = (s: string) => parseReminder(s, NOW);

describe('parseReminder', () => {
  it('relative times', () => {
    expect(p('nhắc tôi sau 20 phút uống nước')).toEqual({ at: NOW + 20 * 60_000, text: 'uống nước' });
    expect(p('nhac toi sau 2 tieng goi lai')).toEqual({ at: NOW + 2 * 3_600_000, text: 'goi lai' });
    expect(p('remind me in 10 minutes to stretch')).toEqual({ at: NOW + 10 * 60_000, text: 'stretch' });
    expect(p('remind me to stretch in an hour')).toEqual({ at: NOW + 3_600_000, text: 'stretch' });
    expect(p('Vega ơi, nhắc mình trong nửa tiếng nữa tắt bếp nhé')).toEqual({ at: NOW + 30 * 60_000, text: 'tắt bếp' });
  });

  it('clock times, Vietnamese and English', () => {
    expect(p('nhắc tôi 3 giờ chiều gọi mẹ')).toEqual({ at: at(19, 15), text: 'gọi mẹ' });
    expect(p('nhắc tôi lúc 15:30 họp nhóm')).toEqual({ at: at(19, 15, 30), text: 'họp nhóm' });
    expect(p('nhắc tôi 8 giờ rưỡi tối nộp bài')).toEqual({ at: at(19, 20, 30), text: 'nộp bài' });
    expect(p('nhắc tôi 7h sáng mai dậy chạy bộ')).toEqual({ at: at(20, 7), text: 'dậy chạy bộ' });
    expect(p('remind me at 5pm to call mom')).toEqual({ at: at(19, 17), text: 'call mom' });
    expect(p('remind me to call mom at 5 pm')).toEqual({ at: at(19, 17), text: 'call mom' });
    expect(p('remind me tomorrow at 9am to pay rent')).toEqual({ at: at(20, 9), text: 'pay rent' });
    expect(p('nhắc tôi ngày mai lúc 9 giờ đóng tiền nhà')).toEqual({ at: at(20, 9), text: 'đóng tiền nhà' });
  });

  it('an hour without a period means the next one; a time already past today means tomorrow', () => {
    expect(p('nhắc tôi lúc 3 giờ uống thuốc')).toEqual({ at: at(19, 15), text: 'uống thuốc' }); // 14:05 → 15:00, not 03:00
    expect(p('nhắc tôi lúc 9 giờ sáng uống thuốc')).toEqual({ at: at(20, 9), text: 'uống thuốc' });
    expect(p('nhắc tôi 2 giờ chiều họp')).toEqual({ at: at(20, 14), text: 'họp' });
  });

  it('a bare number is part of the text, not the time', () => {
    expect(p('nhắc tôi gọi 2 người lúc 5 giờ chiều')).toEqual({ at: at(19, 17), text: 'gọi 2 người' });
  });

  it('not understood → null (the LLM handles it); not a reminder → undefined', () => {
    expect(p('nhắc tôi gọi mẹ')).toBeNull();
    expect(p('nhắc tôi khi nào trời mưa thì đóng cửa')).toBeNull();
    expect(p('nhắc tôi 25 giờ')).toBeNull();
    expect(p('nhắc tôi hôm nay lúc 9 giờ sáng')).toBeNull(); // already past, and "today" was said
    expect(p('phòng mấy độ')).toBeUndefined();
    expect(p('bật đèn')).toBeUndefined();
  });

  it('no text left → "Reminder"', () => {
    expect(p('nhắc tôi sau 5 phút')).toEqual({ at: NOW + 5 * 60_000, text: 'Reminder' });
  });
});
