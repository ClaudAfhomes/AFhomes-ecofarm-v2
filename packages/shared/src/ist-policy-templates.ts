import type { IstCompensationPolicy, IstRank } from './ist-payroll.js';

/** Reference data only. Live payroll must resolve an approved database policy. */
export const IST_POLICY_REFERENCE = Object.freeze({
  version: 'afhomes-table-a-v1',
  source: 'AFHomes historical Table A; BR-PB-03 (B8 section 2), BR-PB-02 collection quota',
});

export const IST_POLICY_TEMPLATES: Readonly<Record<IstRank, Readonly<IstCompensationPolicy>>> =
  Object.freeze({
    SM: Object.freeze({
      version: IST_POLICY_REFERENCE.version,
      rank: 'SM',
      monthlyBa: '15000.00',
      baTarget: '200000.00',
      monthlyPa: '15000.00',
      paTarget: '1000000.00',
      pbTarget: '2000000.00',
      pbRate: '0.01',
      collectionGate: '0.40',
    }),
    SSM: Object.freeze({
      version: IST_POLICY_REFERENCE.version,
      rank: 'SSM',
      monthlyBa: '25000.00',
      baTarget: '600000.00',
      monthlyPa: '25000.00',
      paTarget: '2000000.00',
      pbTarget: '4000000.00',
      pbRate: '0.03',
      collectionGate: '0.40',
    }),
    SVD: Object.freeze({
      version: IST_POLICY_REFERENCE.version,
      rank: 'SVD',
      monthlyBa: '50000.00',
      baTarget: '1800000.00',
      monthlyPa: '50000.00',
      paTarget: '5000000.00',
      pbTarget: '10000000.00',
      pbRate: '0.02',
      collectionGate: '0.40',
    }),
  });
