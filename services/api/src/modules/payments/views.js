// What customers and admins see of payments and refunds (D-84, D-87). Customers never see gateway ids,
// fees or raw events.

const WAITING = ['INITIATED', 'PENDING'];

/**
 * The customer's view of the online payment: whether it can still be paid, and a fresh short-lived link.
 * @param {any} p payment row
 * @param {{ payLink: (id: string) => { path: string, token: string } }} payments
 */
export function customerPaymentView(p, payments) {
  if (!p) return null;
  const canPay = WAITING.includes(p.status) && Boolean(p.providerOrderId);
  return {
    id: p.id,
    status: p.status,
    method: p.method,
    amountPaise: p.amountPaise,
    expiresAt: p.expiresAt,
    lastError: WAITING.includes(p.status) ? (p.failureReason ?? null) : null,
    canPay,
    ready: Boolean(p.providerOrderId),
    pay: canPay ? payments.payLink(p.id) : null,
  };
}

/** Refunds as the customer sees them: amount, status in plain words, when. */
export function customerRefundView(r) {
  return {
    id: r.id,
    amountPaise: r.amountPaise,
    status: r.status,
    toGateway: Boolean(r.paymentId),
    createdAt: r.createdAt,
    processedAt: r.processedAt,
  };
}

export function adminRefundView(r) {
  return {
    id: r.id,
    orderId: r.orderId,
    orderNumber: r.order?.orderNumber,
    restaurant: r.order?.restaurant?.name,
    paymentId: r.paymentId,
    type: r.type,
    status: r.status,
    amountPaise: r.amountPaise,
    reason: r.reason,
    breakdown: r.breakdown ?? null,
    bearer: r.bearer,
    actorType: r.actorType,
    actorId: r.actorId,
    approvedById: r.approvedById,
    approvedAt: r.approvedAt,
    rejectionReason: r.rejectionReason,
    providerRefundId: r.providerRefundId,
    manualReference: r.manualReference,
    attempts: r.attempts,
    failureReason: r.failureReason,
    processedAt: r.processedAt,
    createdAt: r.createdAt,
  };
}

/** @param {any} p @param {{ detail?: boolean }} [o] */
export function adminPaymentView(p, { detail = false } = {}) {
  const base = {
    id: p.id,
    orderId: p.orderId,
    orderNumber: p.order?.orderNumber,
    restaurant: p.order?.restaurant?.name,
    method: p.method,
    provider: p.provider,
    status: p.status,
    amountPaise: p.amountPaise,
    capturedPaise: p.capturedPaise,
    refundedPaise: p.refundedPaise,
    gatewayFeePaise: p.gatewayFeePaise,
    gatewayTaxPaise: p.gatewayTaxPaise,
    providerOrderId: p.providerOrderId,
    providerPaymentId: p.providerPaymentId,
    expiresAt: p.expiresAt,
    succeededAt: p.succeededAt,
    failedAt: p.failedAt,
    failureReason: p.failureReason,
    codCollectedAt: p.codCollectedAt,
    createdAt: p.createdAt,
  };
  if (!detail) return base;
  return {
    ...base,
    attempts: (p.attempts ?? []).map((a) => ({
      id: a.id,
      status: a.status,
      providerPaymentId: a.providerPaymentId,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      createdAt: a.createdAt,
    })),
    // Raw gateway payloads stay in the database; admins see what arrived and whether it was handled.
    events: (p.events ?? []).map((e) => ({
      id: e.id,
      eventType: e.eventType,
      providerEventId: e.providerEventId,
      signatureValid: e.signatureValid,
      processedAt: e.processedAt,
      processingError: e.processingError,
      receivedAt: e.receivedAt,
    })),
    refunds: (p.refunds ?? []).map(adminRefundView),
  };
}
