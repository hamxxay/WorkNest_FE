/**
 * Pure pricing / deposit / space-type helpers moved verbatim from Manage (manage.ts).
 * Manage keeps one-line delegates with the original signatures, so every existing caller is unchanged.
 */

/** A month count as the API accepts it: a whole number 0-3 (anything else, incl. missing, is 0). */
export function clampDepositMonths(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 0;
}

/**
 * 2 decimals, halves away from zero, as the API rounds its decimals (MidpointRounding.AwayFromZero). Binary float
 * noise is dropped first (15 significant digits), so 10,001 x 0.895 = 8,950.895 gives 8,950.90 here as there.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clean = Number(value.toPrecision(15));
  const shifted = Number(`${Math.round(Number(`${Math.abs(clean)}e2`))}e-2`);
  const rounded = Number.isFinite(shifted) ? shifted : Math.round(Math.abs(clean) * 100) / 100;
  return clean < 0 ? -rounded : rounded;
}

/** Deposit amount = months x monthly rent x (1 - rent discount %), 2 decimals: the figure the API stores. */
export function depositAmount(months: number, monthlyRent: number, discountPct: number): number {
  if (!(months > 0) || !(monthlyRent > 0)) return 0;
  const pct = Math.min(100, Math.max(0, Number(discountPct) || 0));
  return Math.max(0, round2(months * monthlyRent * (1 - pct / 100)));
}

/**
 * A stored deposit as the API reads it back (SecurityDepositRules.Stored): the stored amount; a stored 0 with
 * months > 0 on a contract space (private office / shared space) = months x rent x (1 - discount); else none.
 */
export function storedDeposit(isContractSpace: boolean, storedAmount: unknown, storedMonths: unknown,
  monthlyRent: number, discountPct: number): number {
  const amount = Number(storedAmount ?? 0);
  if (amount > 0) return round2(amount);
  if (!isContractSpace) return 0;
  return depositAmount(Number(storedMonths ?? 0), monthlyRent, discountPct);
}

/** Months behind a stored deposit amount when a response has no month count (older API). */
export function depositMonthsFromAmount(amount: unknown, monthlyRent: number, discountPct: number): number {
  const perMonth = depositAmount(1, monthlyRent, discountPct);
  const a = Number(amount ?? 0);
  return a > 0 && perMonth > 0 ? clampDepositMonths(a / perMonth) : 0;
}

/**
 * The rent discount as a percentage of the monthly rent: a fixed amount ("Amount" / "Fixed") converts to its share
 * of ONE month's rent (at most 100%); any other type is a percentage (as SecurityDepositRules.DiscountFraction).
 */
export function rentDiscountPct(discountType: string, discountValue: unknown, monthlyRent: number): number {
  const val = Number(discountValue || 0);
  if (!(val > 0)) return 0;
  if (!/^(amount|fixed)$/i.test(String(discountType ?? '').trim())) return Math.min(100, val);
  return monthlyRent > 0 ? Math.min(100, (val / monthlyRent) * 100) : 0;
}

export function getChallanContractMonths(c: any): number {
  if (!c) return 1;
  if (c.contractPeriodMonths != null && Number(c.contractPeriodMonths) > 0) return Number(c.contractPeriodMonths);
  if (c.ContractPeriodMonths != null && Number(c.ContractPeriodMonths) > 0) return Number(c.ContractPeriodMonths);
  if (c.contract?.numberOfMonths != null && Number(c.contract.numberOfMonths) > 0) return Number(c.contract.numberOfMonths);
  if (c.Contract?.NumberOfMonths != null && Number(c.Contract.NumberOfMonths) > 0) return Number(c.Contract.NumberOfMonths);
  if (c.numberOfMonths != null && Number(c.numberOfMonths) > 0) return Number(c.numberOfMonths);
  if (c.NumberOfMonths != null && Number(c.NumberOfMonths) > 0) return Number(c.NumberOfMonths);
  if (c.durationMonths != null && Number(c.durationMonths) > 0) return Number(c.durationMonths);
  if (c.DurationMonths != null && Number(c.DurationMonths) > 0) return Number(c.DurationMonths);
  if (c.months != null && Number(c.months) > 0) return Number(c.months);
  if (c.Months != null && Number(c.Months) > 0) return Number(c.Months);

  const start = c.startDateTime || c.StartDateTime || c.startOn || c.StartOn || c.contractStartDate || c.ContractStartDate || c.contract?.contractStartDate;
  const end = c.endDateTime || c.EndDateTime || c.endOn || c.EndOn || c.contractEndDate || c.ContractEndDate || c.contract?.contractEndDate;
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      const diffMonths = ((e.getFullYear() - s.getFullYear()) * 12) + (e.getMonth() - s.getMonth());
      if (diffMonths > 0) return diffMonths;
      const diffDays = Math.ceil((e.getTime() - s.getTime()) / 86400000);
      const calculated = Math.max(1, Math.round(diffDays / 30));
      if (calculated > 0) return calculated;
    }
  }

  const details = c.details || c.Details || c.items || c.Items || c.lineItems || c.LineItems || [];
  const rentLine = Array.isArray(details) ? details.find((d: any) => {
    const ft = String(d.feeType || d.FeeType || '').toLowerCase();
    return ft === 'roomrent' || ft === 'rent';
  }) : null;
  if (rentLine && Number(rentLine.quantity || rentLine.Quantity) > 0) {
    return Number(rentLine.quantity || rentLine.Quantity);
  }

  return Number(c.billingPeriodMonths ?? c.BillingPeriodMonths ?? 1);
}

export function getChallanBillingMonths(c: any): number {
  if (!c) return 3;
  return Number(c.billingPeriodMonths ?? c.BillingPeriodMonths ?? 3);
}

/** Months behind a booking's deposit: the stored months, else the deposit line's; 0 when unknown (never a default). */
export function getChallanSecurityMonths(c: any): number {
  if (!c) return 0;
  const storedMonths = Number(c.securityDepositMonths ?? c.SecurityDepositMonths ?? 0);
  if (storedMonths > 0) return storedMonths;
  const details = c.details || c.Details || c.items || c.Items || c.lineItems || c.LineItems || [];
  const secLine = Array.isArray(details) ? details.find((d: any) => {
    const ft = String(d.feeType || d.FeeType || '').toLowerCase();
    const desc = String(d.description || d.Description || '').toLowerCase();
    return ft === 'securitydeposit' || desc.includes('security deposit');
  }) : null;
  if (secLine && Number(secLine.quantity || secLine.Quantity) !== undefined && !isNaN(Number(secLine.quantity || secLine.Quantity))) {
    return Number(secLine.quantity || secLine.Quantity);
  }
  if (secLine && (secLine.description || secLine.Description)) {
    const match = String(secLine.description || secLine.Description).match(/(\d+)\s*Month/i);
    if (match && match[1]) return Number(match[1]);
  }
  return 0;
}

export function getChallanMonthlyRent(c: any): number {
  if (!c || isMeetingRoom(c)) return 0;
  const dbMonthly = c.monthlyRent ?? c.MonthlyRent ?? c.roomPrice ?? c.RoomPrice;
  if (dbMonthly !== undefined && dbMonthly !== null && Number(dbMonthly) > 0) {
    return Number(dbMonthly);
  }
  const months = getChallanContractMonths(c);
  const dbSubtotal = c.subtotalAmount ?? c.SubtotalAmount ?? c.totalContractAmount ?? c.TotalContractAmount;
  if (dbSubtotal !== undefined && dbSubtotal !== null && Number(dbSubtotal) > 0 && months > 0) {
    return Number(dbSubtotal) / months;
  }
  const seatPrice = Number(c.seatPrice ?? c.SeatPrice ?? 0);
  // seats from the record only: the bracket in the space name is the room code, not seats
  const capacity = Number(c.capacity ?? c.Capacity ?? c.spaceCapacity ?? c.SpaceCapacity ?? 0);
  const typeName = String(c.spaceTypeName || c.SpaceTypeName || '').toLowerCase();
  const isPrivate = typeName.includes('private') || typeName.includes('office') || typeName.includes('room');

  if (isPrivate && capacity > 0 && seatPrice > 0) {
    return seatPrice * capacity;
  }
  if (seatPrice > 0) return seatPrice;
  return 0;
}

export function getChallanTotalContract(c: any): number {
  if (!c) return 0;
  if (isMeetingRoom(c)) {
    return Number(c.subtotalAmount ?? c.SubtotalAmount ?? c.totalAmount ?? c.TotalAmount ?? 0);
  }
  const dbTotal = c.totalContractAmount ?? c.TotalContractAmount ?? c.subtotalAmount ?? c.SubtotalAmount;
  if (dbTotal !== undefined && dbTotal !== null && Number(dbTotal) > 0 && Number(dbTotal) !== Number(c.totalAmount) && Number(dbTotal) !== Number(c.totalPayable)) {
    return Number(dbTotal);
  }
  const months = getChallanContractMonths(c);
  const monthlyRent = getChallanMonthlyRent(c);
  return monthlyRent * months;
}

export function getChallanFirstCycleRent(c: any): number {
  if (!c) return 0;
  if (isMeetingRoom(c)) {
    return Number(c.subtotalAmount ?? c.SubtotalAmount ?? c.totalAmount ?? c.TotalAmount ?? 0);
  }
  const dbCycle = c.currentCycleAmount ?? c.CurrentCycleAmount ?? c.firstCycleRent ?? c.FirstCycleRent;
  if (dbCycle !== undefined && dbCycle !== null && Number(dbCycle) > 0 && Number(dbCycle) < Number(getChallanTotalContract(c))) {
    return Number(dbCycle);
  }
  const bpm = getChallanBillingMonths(c);
  const monthlyRent = getChallanMonthlyRent(c);
  return monthlyRent * bpm;
}

/** A booking's security deposit: the stored amount; if that is 0 but stored months > 0 on a private office (older
 *  rows), months x monthly rent x (1 - discount). No stored months = no deposit (months are never defaulted). */
export function getChallanSecurityDeposit(c: any): number {
  if (!c) return 0;
  const storedMonths = Number(c.securityDepositMonths ?? c.SecurityDepositMonths ?? 0);
  const discAmount = Number(c.discountAmount ?? c.DiscountAmount ?? 0);
  const subtotal = Number(c.subtotalAmount ?? c.SubtotalAmount ?? 0);
  const discPct = Number(c.discountPercentage ?? c.DiscountPercentage ?? (subtotal > 0 && discAmount > 0 ? (discAmount / subtotal) * 100 : 0));
  return storedDeposit(isPrivateRoom(c) || isSharedSpace(c), c.securityDeposit ?? c.SecurityDeposit, storedMonths,
    getChallanMonthlyRent(c), discPct);
}

export function getChallanSupportCharges(c: any): number {
  if (!c || isMeetingRoom(c)) return 0;
  const rate = Number(c.perSeatSupportRate ?? c.PerSeatSupportRate ?? 2000);
  const capacity = getChallanCapacity(c);
  const billingM = getChallanBillingMonths(c);
  const billingMonths = billingM > 0 ? billingM : 3;
  return rate * capacity * billingMonths;
}

/** Seats on the booking (capacity sent with the booking / challan). The bracket in the space name is the room
 *  code (e.g. "Office 303 (303)"), not seats, so it is no longer used. */
export function getChallanCapacity(c: any): number {
  const cap = Number(c?.capacity ?? c?.Capacity ?? c?.spaceCapacity ?? c?.SpaceCapacity ?? 0);
  return cap > 0 ? cap : 1;
}

export function getChallanTaxAmount(c: any): number {
  if (!c) return 0;
  if (isMeetingRoom(c)) {
    // meeting rooms: support = 10% of the discounted rent, PST = 16% of that (same as the invoice)
    const discounted = Math.max(0, getChallanFirstCycleRent(c) - getChallanFirstCycleDiscount(c));
    return Math.round(discounted * 0.10 * 0.16 * 100) / 100;
  }
  const supportServices = getChallanSupportCharges(c);
  const taxRate = Number(c.appliedTaxPercentage ?? c.AppliedTaxPercentage ?? 16);
  return Math.round(supportServices * (taxRate / 100) * 100) / 100;
}

export function getChallanContractTaxAmount(c: any): number {
  if (!c || isMeetingRoom(c)) return 0;
  const rate = Number(c.perSeatSupportRate ?? c.PerSeatSupportRate ?? 2000);
  const capacity = getChallanCapacity(c);
  const contractMonths = getChallanContractMonths(c);
  const totalMonths = contractMonths > 0 ? contractMonths : 12;
  const taxRate = Number(c.appliedTaxPercentage ?? c.AppliedTaxPercentage ?? 16);
  const totalSupport = rate * capacity * totalMonths;
  return Math.round(totalSupport * (taxRate / 100) * 100) / 100;
}

export function getChallanFirstCycleDiscount(c: any): number {
  if (!c) return 0;
  const cycleRent = getChallanFirstCycleRent(c);
  const discPct = Number(c.discountPercentage ?? c.DiscountPercentage ?? 0);
  if (discPct > 0) {
    return Math.round(cycleRent * (discPct / 100) * 100) / 100;
  }
  const totalDisc = Number(c.discountAmount ?? c.DiscountAmount ?? 0);
  if (totalDisc > 0) {
    return Math.min(cycleRent, totalDisc);
  }
  const discVal = Number(c.discountValue ?? c.DiscountValue ?? 0);
  if (discVal > 0) {
    return Math.min(cycleRent, discVal);
  }
  return 0;
}

export function getChallanInitialPayable(c: any): number {
  if (!c) return 0;
  const cycleRent = getChallanFirstCycleRent(c);
  const deposit = getChallanSecurityDeposit(c);
  const tax = getChallanTaxAmount(c);
  const discount = getChallanFirstCycleDiscount(c);
  return Math.max(0, cycleRent + deposit + tax - discount);
}

export function getQuotationContractMonths(q: any): number {
  if (!q) return 1;
  if (q.contractPeriodMonths != null && Number(q.contractPeriodMonths) > 0) return Number(q.contractPeriodMonths);
  if (q.ContractPeriodMonths != null && Number(q.ContractPeriodMonths) > 0) return Number(q.ContractPeriodMonths);
  if (q.contract?.numberOfMonths != null && Number(q.contract.numberOfMonths) > 0) return Number(q.contract.numberOfMonths);
  if (q.Contract?.NumberOfMonths != null && Number(q.Contract.NumberOfMonths) > 0) return Number(q.Contract.NumberOfMonths);
  if (q.numberOfMonths != null && Number(q.numberOfMonths) > 0) return Number(q.numberOfMonths);
  if (q.NumberOfMonths != null && Number(q.NumberOfMonths) > 0) return Number(q.NumberOfMonths);
  if (q.durationMonths != null && Number(q.durationMonths) > 0) return Number(q.durationMonths);
  if (q.DurationMonths != null && Number(q.DurationMonths) > 0) return Number(q.DurationMonths);
  if (q.months != null && Number(q.months) > 0) return Number(q.months);
  if (q.Months != null && Number(q.Months) > 0) return Number(q.Months);

  const start = q.startDateTime || q.StartDateTime || q.startOn || q.StartOn || q.contractStartDate || q.ContractStartDate || q.contract?.contractStartDate;
  const end = q.endDateTime || q.EndDateTime || q.endOn || q.EndOn || q.contractEndDate || q.ContractEndDate || q.contract?.contractEndDate;
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      const diffMonths = ((e.getFullYear() - s.getFullYear()) * 12) + (e.getMonth() - s.getMonth());
      if (diffMonths > 0) return diffMonths;
      const diffDays = Math.ceil((e.getTime() - s.getTime()) / 86400000);
      const calculated = Math.max(1, Math.round(diffDays / 30));
      if (calculated > 0) return calculated;
    }
  }

  const details = q.details || q.Details || [];
  const rentLine = Array.isArray(details) ? details.find((d: any) => {
    const ft = String(d.feeType || d.FeeType || '').toLowerCase();
    return ft === 'roomrent' || ft === 'rent';
  }) : null;
  if (rentLine && Number(rentLine.quantity || rentLine.Quantity) > 0) {
    return Number(rentLine.quantity || rentLine.Quantity);
  }

  return Number(q.billingPeriodMonths ?? q.BillingPeriodMonths ?? 1);
}

export function getQuotationBillingMonths(q: any): number {
  if (!q) return 3;
  return Number(q.billingPeriodMonths ?? q.BillingPeriodMonths ?? 3);
}

/** Months behind a quotation's deposit: the stored months, else the deposit line's; 0 when unknown (never a default). */
export function getQuotationSecurityMonths(q: any): number {
  if (!q) return 0;
  const storedMonths = Number(q.securityDepositMonths ?? q.SecurityDepositMonths ?? 0);
  if (storedMonths > 0) return storedMonths;
  const details = q.details || q.Details || [];
  const secLine = Array.isArray(details) ? details.find((d: any) => {
    const ft = String(d.feeType || d.FeeType || '').toLowerCase();
    const desc = String(d.description || d.Description || '').toLowerCase();
    return ft === 'securitydeposit' || desc.includes('security deposit');
  }) : null;
  if (secLine && Number(secLine.quantity || secLine.Quantity) !== undefined && !isNaN(Number(secLine.quantity || secLine.Quantity))) {
    return Number(secLine.quantity || secLine.Quantity);
  }
  if (secLine && (secLine.description || secLine.Description)) {
    const match = String(secLine.description || secLine.Description).match(/(\d+)\s*Month/i);
    if (match && match[1]) return Number(match[1]);
  }
  return 0;
}

export function getQuotationMonthlyRent(q: any): number {
  if (!q || isMeetingRoom(q)) return 0;
  const dbMonthly = q.monthlyRent ?? q.MonthlyRent ?? q.roomPrice ?? q.RoomPrice;
  if (dbMonthly !== undefined && dbMonthly !== null && Number(dbMonthly) > 0) {
    return Number(dbMonthly);
  }
  const months = getQuotationContractMonths(q);
  const dbSubtotal = q.subtotalAmount ?? q.SubtotalAmount ?? q.totalContractAmount ?? q.TotalContractAmount;
  if (dbSubtotal !== undefined && dbSubtotal !== null && Number(dbSubtotal) > 0 && months > 0) {
    return Number(dbSubtotal) / months;
  }
  const seatPrice = Number(q.seatPrice ?? q.SeatPrice ?? 0);
  // seats from the record only: the bracket in the space name is the room code, not seats
  const capacity = Number(q.capacity ?? q.Capacity ?? q.spaceCapacity ?? q.SpaceCapacity ?? 0);
  const typeName = String(q.spaceTypeName || q.SpaceTypeName || '').toLowerCase();
  const isPrivate = typeName.includes('private') || typeName.includes('office') || typeName.includes('room');

  if (isPrivate && capacity > 0 && seatPrice > 0) {
    return seatPrice * capacity;
  }
  if (seatPrice > 0) return seatPrice;
  return 0;
}

export function getQuotationTotalContract(q: any): number {
  if (!q) return 0;
  if (isMeetingRoom(q)) {
    return Number(q.subtotalAmount ?? q.SubtotalAmount ?? q.totalAmount ?? q.TotalAmount ?? 0);
  }
  const months = getQuotationContractMonths(q);
  const monthlyRent = getQuotationMonthlyRent(q);
  return monthlyRent * months;
}

export function getQuotationFirstCycleRent(q: any): number {
  if (!q) return 0;
  if (isMeetingRoom(q)) {
    return Number(q.subtotalAmount ?? q.SubtotalAmount ?? q.totalAmount ?? q.TotalAmount ?? 0);
  }
  const bpm = getQuotationBillingMonths(q);
  const monthlyRent = getQuotationMonthlyRent(q);
  return monthlyRent * bpm;
}

/** A quotation's security deposit: the stored amount; if that is 0 but stored months > 0 on a private office (older
 *  rows; an old shared row can hold 1 month with no amount), months x monthly rent x (1 - rent discount). No stored
 *  months = no deposit (months are never defaulted). */
export function getQuotationSecurityDeposit(q: any): number {
  if (!q) return 0;
  const storedMonths = Number(q.securityDepositMonths ?? q.SecurityDepositMonths ?? 0);
  const monthlyRent = getQuotationMonthlyRent(q);
  const discType = q.discountType ?? q.DiscountType;
  const discPct = (discType === 'Amount' || discType === 'Fixed')
    ? rentDiscountPct('Amount', q.discountValue ?? q.DiscountValue, monthlyRent)
    : getQuotationDiscountPercentage(q);
  return storedDeposit(isPrivateRoom(q) || isSharedSpace(q), q.securityDeposit ?? q.SecurityDeposit, storedMonths, monthlyRent, discPct);
}

export function getQuotationSupportCharges(q: any): number {
  if (!q || isMeetingRoom(q)) return 0;
  const capacity = getChallanCapacity(q);   // seats from the quotation, not the space-name bracket
  const bpm = getQuotationBillingMonths(q);
  const perSeatSupportRate = Number(q.perSeatSupportRate ?? q.PerSeatSupportRate ?? 2000);
  return perSeatSupportRate * capacity * bpm;
}

export function getQuotationTaxAmount(q: any): number {
  if (!q) return 0;
  if (isMeetingRoom(q)) {
    // meeting rooms: support = 10% of the rent, PST = 16% of that (same as the invoice)
    const base = Number(q.subtotalAmount ?? q.SubtotalAmount ?? q.totalAmount ?? q.TotalAmount ?? 0);
    const discounted = Math.max(0, base - getQuotationDiscountAmount(q));
    return Math.round(discounted * 0.10 * 0.16 * 100) / 100;
  }
  const supportServices = getQuotationSupportCharges(q);
  const taxPct = Number(q.appliedTaxPercentage ?? q.AppliedTaxPercentage ?? 16);
  return Math.round(supportServices * (taxPct / 100) * 100) / 100;
}

export function getQuotationContractTaxAmount(q: any): number {
  if (!q || isMeetingRoom(q)) return 0;
  const capacity = getChallanCapacity(q);   // seats from the quotation, not the space-name bracket
  const contractMonths = getQuotationContractMonths(q);
  const perSeatSupportRate = Number(q.perSeatSupportRate ?? q.PerSeatSupportRate ?? 2000);
  const totalSupport = perSeatSupportRate * capacity * contractMonths;
  const taxPct = Number(q.appliedTaxPercentage ?? q.AppliedTaxPercentage ?? 16);
  return Math.round(totalSupport * (taxPct / 100) * 100) / 100;
}

export function getQuotationDiscountAmount(q: any): number {
  if (!q) return 0;
  const discType = q.discountType ?? q.DiscountType;
  const discVal = Number(q.discountValue ?? q.DiscountValue ?? 0);
  const bpm = getQuotationBillingMonths(q);
  if ((discType === 'Amount' || discType === 'Fixed') && discVal > 0) {
    if (isMeetingRoom(q)) return discVal;
    return discVal * bpm;
  }
  const pct = q.discountPercentage ?? q.DiscountPercentage;
  if (pct != null && Number(pct) > 0) {
    const cycleRent = getQuotationFirstCycleRent(q);
    return Math.round(cycleRent * (Number(pct) / 100) * 100) / 100;
  }
  return Number(q.discountAmount ?? q.DiscountAmount ?? 0);
}

export function getQuotationDiscountPercentage(q: any): number {
  if (!q) return 0;
  const pct = q.discountPercentage ?? q.DiscountPercentage;
  if (pct != null && Number(pct) > 0) return Number(pct);
  const discType = q.discountType ?? q.DiscountType;
  const discVal = Number(q.discountValue ?? q.DiscountValue ?? 0);
  const monthlyRent = getQuotationMonthlyRent(q);
  if ((discType === 'Amount' || discType === 'Fixed') && discVal > 0 && monthlyRent > 0) {
    return parseFloat(((discVal / monthlyRent) * 100).toFixed(2));
  }
  const disc = getQuotationDiscountAmount(q);
  const cycleRent = getQuotationFirstCycleRent(q);
  if (disc > 0 && cycleRent > 0) {
    return parseFloat(((disc / cycleRent) * 100).toFixed(2));
  }
  return 0;
}

export function getQuotationInitialPayable(q: any): number {
  if (!q) return 0;
  const cycleRent = getQuotationFirstCycleRent(q);
  const deposit = getQuotationSecurityDeposit(q);
  const tax = getQuotationTaxAmount(q);
  const discount = getQuotationDiscountAmount(q);
  return Math.max(0, parseFloat(((cycleRent - discount) + deposit + tax).toFixed(2)));
}

export function getQuotationNetTotal(q: any): number {
  return getQuotationInitialPayable(q);
}

export function getSpaceType(item: any): string {
  if (!item) return 'MeetingRoom';
  const raw = String(item.spaceType || item.SpaceType || item.spaceCategory || item.SpaceCategory || '').toLowerCase();
  if (raw === 'privateroom' || raw === 'private' || raw.includes('private')) return 'PrivateRoom';
  if (raw === 'sharedspace' || raw === 'shared' || raw.includes('shared') || raw.includes('desk') || raw.includes('coworking')) return 'SharedSpace';
  if (raw === 'meetingroom' || raw === 'meeting' || raw.includes('meeting') || raw.includes('conference')) return 'MeetingRoom';

  const name = String(item.name || item.Name || item.title || item.Title || item.spaceTypeName || item.SpaceTypeName || item.spaceName || item.SpaceName || '').toLowerCase();
  if (name.includes('meeting') || name.includes('conference') || name.includes('board')) return 'MeetingRoom';
  if (name.includes('shared') || name.includes('coworking') || name.includes('desk') || name.includes('open')) return 'SharedSpace';
  if (name.includes('private') || name.includes('office') || name.includes('room')) return 'PrivateRoom';
  if ((item.billingPeriodMonths <= 0 || !item.billingPeriodMonths) && (!item.totalContractAmount || item.totalContractAmount <= 0)) return 'MeetingRoom';
  return 'SharedSpace';
}

export function isMeetingRoom(item: any): boolean {
  return getSpaceType(item) === 'MeetingRoom';
}

export function isSharedSpace(item: any): boolean {
  return getSpaceType(item) === 'SharedSpace';
}

export function isPrivateRoom(item: any): boolean {
  return getSpaceType(item) === 'PrivateRoom';
}
