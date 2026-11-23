import { expect, it } from 'vitest';
import { toCard, toMembership } from './membership-model.js';
it('keeps the VIP Card ID distinct from the membership code in card and membership DTOs', () => {
  const row = {
    id: 'membership',
    sale_id: 'sale',
    membership_number: 'AF-MEMBER-CODE',
    customers: { first_name: 'ANA', last_name: 'SANTOS', vip_card_number: '26110800001G1C01S' },
    card_plans: { name: 'Gold', code: 'GOLD' },
  };
  for (const dto of [
    toCard(row, new Map(), new Map(), new Map()),
    toMembership(row, new Map(), new Map(), new Map()),
  ]) {
    expect(dto.vipCardNumber).toBe('26110800001G1C01S');
    expect(dto.membershipNumber).toBe('AF-MEMBER-CODE');
  }
});
