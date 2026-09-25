// Delivery partner netting (SETTLEMENTS.md §3, D-91): cash held is taken from earnings before paying.

/**
 * @param {{ earningsPaise: number, codHeldPaise: number, netting: boolean }} i
 * @returns {{ codNettedPaise: number, payablePaise: number, owesPaise: number }}
 *   payablePaise: what Jamzo pays now; owesPaise: what the partner still owes after netting.
 */
export function riderNetting({ earningsPaise, codHeldPaise, netting }) {
  const earnings = Math.max(0, earningsPaise);
  const cod = Math.max(0, codHeldPaise);
  if (!netting) return { codNettedPaise: 0, payablePaise: earnings, owesPaise: cod };
  const netted = Math.min(earnings, cod);
  return { codNettedPaise: netted, payablePaise: earnings - netted, owesPaise: cod - netted };
}

/** What a partner sees (§3.2): what they owe Jamzo and what Jamzo owes them, after netting. */
export const riderPosition = ({ earningsPaise, codHeldPaise }) => ({
  owesPaise: Math.max(0, codHeldPaise - earningsPaise),
  owedPaise: Math.max(0, earningsPaise - codHeldPaise),
});
