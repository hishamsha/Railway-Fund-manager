import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';
import { creditCheck, dateOnly } from '../admin/rules.js';
import { journeyRequestJson, transitionRequest } from '../journeys/shared.js';
import { bookingFinancials } from './financials.js';
import { legJson, legRows, legsBody, packagerNetDue, pnr, quoteServiceCharge, requireAccounts,
  routeFromLegs, rupees, ticketStatus, type LegBody } from './legs.js';

const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const paise = z.number().int().safe().min(0).max(1_000_000_000_000);
const station = z.string().trim().min(1).max(160);
const bookingPersonMobile = z.string().trim().regex(/^\+?[1-9][0-9]{9,14}$/, 'Enter 10–15 digits, optionally starting with +').nullable().optional();
// A booking is described either by top-level route fields (one direct leg) or
// by `legs`, from which the route, first journey date and price are derived.
const routeFields = ['boarding_station', 'destination_station', 'journey_date',
  'train_identifier', 'ticket_price_paise'] as const;
function refineRoute(body: { legs?: unknown; boarding_station?: string; destination_station?: string;
  journey_date?: string; train_identifier?: string; ticket_price_paise?: number }, ctx: z.RefinementCtx) {
  for (const field of routeFields) {
    if (body.legs && body[field] !== undefined) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'Omit route fields when legs are given' });
    } else if (!body.legs && body[field] === undefined) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'Required' });
    }
  }
  if (!body.legs && body.boarding_station && body.destination_station &&
    body.boarding_station.toLowerCase() === body.destination_station.toLowerCase()) {
    ctx.addIssue({ code: 'custom', path: ['destination_station'], message: 'Destination must differ from boarding' });
  }
}
const createBody = z.strictObject({
  packager_id: uuid,
  boarding_station: station.optional(),
  destination_station: station.optional(),
  journey_date: z.iso.date().optional(),
  train_identifier: z.string().trim().min(1).max(160).optional(),
  ticket_price_paise: paise.positive().optional(),
  legs: legsBody.optional(),
  // Ticket source fields for a single-leg booking given without `legs`.
  booking_account_id: uuid.nullable().optional(),
  pnr: pnr.nullable().optional(),
  ticket_status: ticketStatus.optional(),
  booking_person_mobile: bookingPersonMobile,
  // Omitted means the packager's service charge rule for the ticket type.
  service_charge_paise: paise.optional(),
  initial_collected_paise: paise.default(0),
  wallet_deducted_paise: paise.default(0),
  wallet_id: uuid.nullable().optional(),
  payment_due_date: z.iso.date().nullable().optional(),
  allow_over_credit_limit: z.boolean().default(false),
  // Books an agency's journey request and links it to this booking.
  journey_request_id: uuid.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).superRefine((body, ctx) => {
  refineRoute(body, ctx);
  if (body.legs) {
    for (const field of ['booking_account_id', 'pnr', 'ticket_status'] as const) {
      if (body[field] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Set this on each leg instead' });
      }
    }
  }
  if (body.wallet_deducted_paise === 0 && body.wallet_id) {
    ctx.addIssue({ code: 'custom', path: ['wallet_id'], message: 'Wallet is only used for a deduction' });
  }
});
const legUpdateBody = z.strictObject({
  ticket_status: ticketStatus.optional(),
  pnr: pnr.nullable().optional(),
  booking_account_id: uuid.nullable().optional(),
  cancellation_charge_paise: paise.optional(),
}).refine((body) => Object.keys(body).length > 0, 'At least one field is required');
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: uuid.optional(), packager_id: uuid.optional() });
const collectionBody = z.strictObject({
  amount_paise: paise.positive(),
  method: z.enum(['cash', 'upi', 'bank', 'other']),
  occurred_at: z.iso.datetime({ offset: true }),
  note: z.string().trim().max(2000).nullable().optional(),
});
const deductionBody = z.strictObject({
  amount_paise: paise.positive(),
  occurred_at: z.iso.datetime({ offset: true }),
  note: z.string().trim().max(2000).nullable().optional(),
});
const editBody = z.strictObject({
  packager_id: uuid,
  boarding_station: station.optional(),
  destination_station: station.optional(),
  journey_date: z.iso.date().optional(),
  train_identifier: z.string().trim().min(1).max(160).optional(),
  // Zero only for a booking whose tickets are all cancelled.
  ticket_price_paise: paise.optional(),
  // Replaces every leg. Without it, a single-leg booking's leg follows the
  // top-level route; a connected booking's route can only change via legs.
  legs: legsBody.optional(),
  booking_person_mobile: bookingPersonMobile,
  payment_due_date: z.iso.date().nullable().optional(),
  service_charge_paise: paise,
  collected_paise: paise,
  wallet_deducted_paise: paise,
  notes: z.string().trim().max(2000).nullable(),
  expected_updated_at: z.iso.datetime({ offset: true }),
  expected_collected_paise: paise,
  expected_wallet_deducted_paise: paise,
  correction_reason: z.string().trim().max(2000).nullable(),
}).superRefine((body, ctx) => {
  refineRoute(body, ctx);
  if ((body.collected_paise !== body.expected_collected_paise ||
    body.wallet_deducted_paise !== body.expected_wallet_deducted_paise) &&
    !body.correction_reason) {
    ctx.addIssue({ code: 'custom', path: ['correction_reason'], message: 'Explain the money correction' });
  }
});
const timelineQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(10000).default(0) });

function operationId(header: string | undefined): string {
  const parsed = uuid.safeParse(header);
  if (!parsed.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A UUID Idempotency-Key header is required');
  return parsed.data;
}
function hash(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
const withLegs = { legs: { orderBy: { sequence: 'asc' } } } as const;
function bookingJson(booking: { id: string; packagerId: string; boardingStation: string;
  destinationStation: string; journeyDate: Date; trainIdentifier: string; bookingPersonMobile: string | null; notes: string | null;
  ticketType: string; paymentDueDate: Date | null; createdAt: Date; updatedAt: Date;
  legs: Parameters<typeof legJson>[0][] }) {
  return { id: booking.id, packager_id: booking.packagerId,
    boarding_station: booking.boardingStation, destination_station: booking.destinationStation,
    journey_date: booking.journeyDate.toISOString().slice(0, 10),
    train_identifier: booking.trainIdentifier, booking_person_mobile: booking.bookingPersonMobile, notes: booking.notes,
    ticket_type: booking.ticketType,
    payment_due_date: booking.paymentDueDate?.toISOString().slice(0, 10) ?? null,
    legs: booking.legs.map(legJson),
    created_at: booking.createdAt.toISOString(), updated_at: booking.updatedAt.toISOString() };
}
/** Legs from the request, or one leg built from the top-level route fields. */
function requestedLegs(body: { legs?: LegBody[]; boarding_station?: string; destination_station?: string;
  journey_date?: string; train_identifier?: string; ticket_price_paise?: number;
  booking_account_id?: string | null; pnr?: string | null; ticket_status?: LegBody['ticket_status'] }): LegBody[] {
  return body.legs ?? [{ boarding_station: body.boarding_station!, destination_station: body.destination_station!,
    journey_date: body.journey_date!, train_identifier: body.train_identifier!,
    fare_paise: body.ticket_price_paise!, booking_account_id: body.booking_account_id,
    pnr: body.pnr, ticket_status: body.ticket_status }];
}

router.get('/', async (request, response, next) => {
  try {
    const query = listQuery.parse(request.query);
    const owner = response.locals.auth.userId as string;
    if (query.cursor && !await getPrisma().booking.findFirst({
      where: { id: query.cursor, ownerId: owner }, select: { id: true },
    })) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    const bookings = await getPrisma().booking.findMany({
      where: { ownerId: owner, ...(query.packager_id ? { packagerId: query.packager_id } : {}) },
      orderBy: { id: 'asc' }, take: query.limit + 1, include: withLegs,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = bookings.slice(0, query.limit);
    response.json({ items: page.map(bookingJson), next_cursor: bookings.length > query.limit ? page.at(-1)?.id : null });
  } catch (error) { next(error); }
});

router.post('/', async (request, response, next) => {
  try {
    const body = createBody.parse(request.body);
    const owner = response.locals.auth.userId as string;
    const requestId = operationId(request.header('Idempotency-Key'));
    const payloadHash = hash(body);
    const result = await getPrisma().$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO app.operation_requests (owner_id, request_id, operation_type, payload_hash)
        VALUES (${owner}::uuid, ${requestId}::uuid, 'create_booking', ${payloadHash})
        ON CONFLICT DO NOTHING`;
      if (!claimed) {
        const previous = await tx.operationRequest.findUniqueOrThrow({
          where: { ownerId_requestId: { ownerId: owner, requestId } },
        });
        if (previous.operationType !== 'create_booking' || previous.payloadHash !== payloadHash || !previous.resultJson) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different request');
        }
        return { status: 200, body: previous.resultJson };
      }
      // Locking the packager serializes concurrent bookings for its credit check.
      const packagers = await tx.$queryRaw<Array<{ name: string; credit_limit_paise: bigint | null }>>`
        SELECT name, credit_limit_paise FROM app.packagers
        WHERE id = ${body.packager_id}::uuid AND owner_id = ${owner}::uuid AND NOT is_archived
        FOR UPDATE`;
      const packager = packagers[0];
      if (!packager) throw new ApiError(404, 'NOT_FOUND', 'Packager not found');
      const legs = requestedLegs(body);
      const route = routeFromLegs(legs);
      await requireAccounts(tx, owner, legs.map((leg) => leg.booking_account_id));
      const serviceCharge = body.service_charge_paise === undefined
        ? await quoteServiceCharge(tx, owner, body.packager_id, route.ticket_type)
        : BigInt(body.service_charge_paise);
      const payable = BigInt(route.ticket_price_paise) + serviceCharge;
      if (packager.credit_limit_paise !== null && !body.allow_over_credit_limit) {
        const limit = BigInt(packager.credit_limit_paise);
        const credit = creditCheck(limit, await packagerNetDue(tx, owner, body.packager_id),
          payable, BigInt(body.initial_collected_paise));
        if (!credit.allowed) {
          throw new ApiError(409, 'CREDIT_LIMIT_EXCEEDED',
            `This booking would raise ${packager.name}'s due to ${rupees(credit.projected_due_paise)}, ` +
            `above the ${rupees(limit)} credit limit`);
        }
      }

      if (body.wallet_deducted_paise > 0 && body.wallet_id) {
        const locked = await tx.$queryRaw<Array<{ current_balance_paise: bigint; is_active: boolean }>>`
          SELECT current_balance_paise, is_active FROM app.wallets
          WHERE id = ${body.wallet_id}::uuid AND owner_id = ${owner}::uuid FOR UPDATE`;
        const wallet = locked[0];
        if (!wallet?.is_active) throw new ApiError(404, 'NOT_FOUND', 'Wallet not found');
        if (BigInt(wallet.current_balance_paise) < BigInt(body.wallet_deducted_paise)) {
          throw new ApiError(409, 'INSUFFICIENT_WALLET_BALANCE', 'Wallet balance is insufficient');
        }
      }

      const created = await tx.booking.create({ data: {
        ownerId: owner, packagerId: body.packager_id,
        boardingStation: route.boarding_station, destinationStation: route.destination_station,
        journeyDate: dateOnly(route.journey_date),
        trainIdentifier: route.train_identifier,
        bookingPersonMobile: body.booking_person_mobile ?? null,
        ticketPricePaise: BigInt(route.ticket_price_paise),
        serviceChargePaise: serviceCharge,
        recordedWalletDeductionPaise: body.wallet_id ? 0n : BigInt(body.wallet_deducted_paise),
        ticketType: route.ticket_type,
        paymentDueDate: body.payment_due_date ? dateOnly(body.payment_due_date) : null,
        notes: body.notes ?? null,
      } });
      await tx.bookingLeg.createMany({ data: legRows(owner, created.id, legs) });
      if (body.journey_request_id) {
        const journey = await transitionRequest(tx,
          { id: body.journey_request_id, ownerId: owner, packagerId: body.packager_id }, 'book',
          { status: 'booked', bookingId: created.id });
        await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner, entityType: 'journey_request',
          entityId: journey.id, action: 'book', afterJson: journeyRequestJson(journey) } });
      }
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: created.id }, include: withLegs });
      const occurredAt = new Date();
      if (body.initial_collected_paise > 0) {
        await tx.customerFundEntry.create({ data: { ownerId: owner, bookingId: booking.id,
          entryType: 'receipt', amountPaise: BigInt(body.initial_collected_paise),
          occurredAt, operationRequestId: requestId } });
      }
      if (body.wallet_deducted_paise > 0 && body.wallet_id) {
        await tx.walletEntry.create({ data: { ownerId: owner, walletId: body.wallet_id!,
          bookingId: booking.id, entryType: 'booking_debit',
          amountPaise: BigInt(body.wallet_deducted_paise), occurredAt,
          operationRequestId: requestId } });
        await tx.wallet.update({ where: { id: body.wallet_id! },
          data: { currentBalancePaise: { decrement: BigInt(body.wallet_deducted_paise) } } });
      }
      const signed = Number(payable) - body.initial_collected_paise;
      const resultJson = { booking: bookingJson(booking), financials: {
        ticket_price_paise: route.ticket_price_paise,
        service_charge_paise: Number(serviceCharge),
        total_payable_paise: Number(payable),
        collected_paise: body.initial_collected_paise,
        wallet_deducted_paise: body.wallet_deducted_paise,
        fund_balance_paise: route.ticket_price_paise - body.wallet_deducted_paise,
        signed_balance_paise: signed,
        balance_due_paise: Math.max(signed, 0),
        advance_credit_paise: Math.max(-signed, 0),
      } };
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'booking', entityId: booking.id, action: 'create',
        afterJson: resultJson } });
      await tx.operationRequest.update({ where: { ownerId_requestId: { ownerId: owner, requestId } },
        data: { resultJson, completedAt: new Date() } });
      return { status: 201, body: resultJson };
    });
    response.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

router.patch('/:id', async (request, response, next) => {
  try {
    const bookingId = uuid.parse(request.params.id);
    const body = editBody.parse(request.body);
    const owner = response.locals.auth.userId as string;
    const requestId = operationId(request.header('Idempotency-Key'));
    const payloadHash = hash({ bookingId, ...body });
    const result = await getPrisma().$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO app.operation_requests (owner_id, request_id, operation_type, payload_hash)
        VALUES (${owner}::uuid, ${requestId}::uuid, 'edit_booking', ${payloadHash})
        ON CONFLICT DO NOTHING`;
      if (!claimed) {
        const previous = await tx.operationRequest.findUniqueOrThrow({
          where: { ownerId_requestId: { ownerId: owner, requestId } },
        });
        if (previous.operationType !== 'edit_booking' || previous.payloadHash !== payloadHash || !previous.resultJson) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different request');
        }
        return previous.resultJson;
      }
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM app.bookings WHERE id = ${bookingId}::uuid
        AND owner_id = ${owner}::uuid FOR UPDATE`;
      if (!locked.length) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      const before = await tx.booking.findFirstOrThrow({ where: { id: bookingId, ownerId: owner }, include: withLegs });
      const previousMoney = await bookingFinancials(before, tx);
      if (before.updatedAt.toISOString() !== body.expected_updated_at ||
        previousMoney.collected_paise !== body.expected_collected_paise ||
        previousMoney.wallet_deducted_paise !== body.expected_wallet_deducted_paise) {
        throw new ApiError(409, 'EDIT_CONFLICT', 'Booking changed. Reload it before editing again');
      }
      const packager = await tx.packager.findFirst({ where: {
        id: body.packager_id, ownerId: owner,
        ...(body.packager_id === before.packagerId ? {} : { isArchived: false }),
      }, select: { id: true } });
      if (!packager) throw new ApiError(404, 'NOT_FOUND', 'Packager not found');
      const changedMoney = body.collected_paise !== previousMoney.collected_paise ||
        body.wallet_deducted_paise !== previousMoney.wallet_deducted_paise;
      if (changedMoney && !body.correction_reason) {
        throw new ApiError(422, 'CORRECTION_REASON_REQUIRED', 'Explain the money correction');
      }
      let legs: LegBody[] | null = body.legs ?? null;
      if (!legs && before.legs.length > 1) {
        const beforeRoute = bookingJson(before);
        if (body.boarding_station !== beforeRoute.boarding_station ||
          body.destination_station !== beforeRoute.destination_station ||
          body.journey_date !== beforeRoute.journey_date ||
          body.train_identifier !== beforeRoute.train_identifier ||
          BigInt(body.ticket_price_paise!) !== before.ticketPricePaise) {
          throw new ApiError(409, 'LEGS_REQUIRED', 'Edit the legs to change a connected booking’s route or price');
        }
      } else if (!legs) {
        // Keep the single leg's ticket source and status while its route follows the booking.
        const current = before.legs[0];
        const cancelled = current?.ticketStatus === 'cancelled';
        // A cancelled ticket's price is its charge, not its fare, so a top-level
        // price cannot say which to change.
        if (cancelled && BigInt(body.ticket_price_paise!) !== before.ticketPricePaise) {
          throw new ApiError(409, 'LEGS_REQUIRED', 'Edit the legs to change a cancelled ticket’s fare or charge');
        }
        if (!cancelled && body.ticket_price_paise === 0) {
          throw new ApiError(422, 'INVALID_LEGS', 'Ticket price must be more than zero');
        }
        const requested = requestedLegs(body)[0]!;
        legs = [{ ...requested, fare_paise: cancelled ? Number(current.farePaise) : requested.fare_paise,
          booking_account_id: current?.bookingAccountId ?? null, pnr: current?.pnr ?? null,
          ticket_status: current?.ticketStatus as LegBody['ticket_status'],
          cancellation_charge_paise: Number(current?.cancellationChargePaise ?? 0) }];
      }
      const route = legs ? routeFromLegs(legs) : { boarding_station: body.boarding_station!,
        destination_station: body.destination_station!, journey_date: body.journey_date!,
        train_identifier: body.train_identifier!, ticket_price_paise: body.ticket_price_paise!,
        ticket_type: 'connected' as const };
      if (legs) {
        const existing = new Set(before.legs.map((leg) => leg.bookingAccountId));
        await requireAccounts(tx, owner, legs.map((leg) => leg.booking_account_id)
          .filter((id) => !existing.has(id ?? null)));
      }
      await tx.booking.update({ where: { id: bookingId }, data: {
        packagerId: body.packager_id,
        boardingStation: route.boarding_station,
        destinationStation: route.destination_station,
        journeyDate: dateOnly(route.journey_date),
        trainIdentifier: route.train_identifier,
        bookingPersonMobile: body.booking_person_mobile === undefined
          ? before.bookingPersonMobile : body.booking_person_mobile,
        ticketPricePaise: BigInt(route.ticket_price_paise),
        serviceChargePaise: BigInt(body.service_charge_paise),
        ticketType: route.ticket_type,
        ...(body.payment_due_date !== undefined ? { paymentDueDate:
          body.payment_due_date === null ? null : dateOnly(body.payment_due_date) } : {}),
        notes: body.notes,
      } });
      const singleLeg = !body.legs && before.legs.length === 1 ? before.legs[0] : undefined;
      if (singleLeg) {
        // Update in place so the leg keeps its id for ticket tracking.
        const [row] = legRows(owner, bookingId, legs!);
        await tx.bookingLeg.update({ where: { id: singleLeg.id }, data: {
          boardingStation: row!.boardingStation, destinationStation: row!.destinationStation,
          journeyDate: row!.journeyDate, trainIdentifier: row!.trainIdentifier, farePaise: row!.farePaise } });
      } else if (legs) {
        await tx.bookingLeg.deleteMany({ where: { ownerId: owner, bookingId } });
        await tx.bookingLeg.createMany({ data: legRows(owner, bookingId, legs) });
      }
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: withLegs });
      const occurredAt = new Date();
      const collectionDelta = body.collected_paise - previousMoney.collected_paise;
      if (collectionDelta !== 0) {
        await tx.customerFundEntry.create({ data: {
          ownerId: owner, bookingId,
          entryType: collectionDelta > 0 ? 'collection_adjustment_increase' : 'collection_adjustment_decrease',
          amountPaise: BigInt(Math.abs(collectionDelta)), occurredAt,
          note: body.correction_reason, operationRequestId: requestId,
        } });
      }
      const deductionDelta = body.wallet_deducted_paise - previousMoney.wallet_deducted_paise;
      if (deductionDelta !== 0) {
        await tx.bookingDeductionEntry.create({ data: {
          ownerId: owner, bookingId,
          entryType: deductionDelta > 0 ? 'booking_debit' : 'deduction_adjustment_decrease',
          amountPaise: BigInt(Math.abs(deductionDelta)), occurredAt,
          note: body.correction_reason, operationRequestId: requestId,
        } });
      }
      const resultJson = { booking: bookingJson(booking), financials: await bookingFinancials(booking, tx) };
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'booking', entityId: bookingId, action: 'edit',
        beforeJson: { booking: bookingJson(before), financials: previousMoney },
        afterJson: resultJson, reason: body.correction_reason } });
      await tx.operationRequest.update({ where: { ownerId_requestId: { ownerId: owner, requestId } },
        data: { resultJson, completedAt: new Date() } });
      return resultJson;
    });
    response.json(result);
  } catch (error) { next(error); }
});

router.post('/:id/collections', async (request, response, next) => {
  try {
    const bookingId = uuid.parse(request.params.id);
    const body = collectionBody.parse(request.body);
    const owner = response.locals.auth.userId as string;
    const requestId = operationId(request.header('Idempotency-Key'));
    const payloadHash = hash({ bookingId, ...body });
    const result = await getPrisma().$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO app.operation_requests (owner_id, request_id, operation_type, payload_hash)
        VALUES (${owner}::uuid, ${requestId}::uuid, 'collect_booking', ${payloadHash})
        ON CONFLICT DO NOTHING`;
      if (!claimed) {
        const previous = await tx.operationRequest.findUniqueOrThrow({
          where: { ownerId_requestId: { ownerId: owner, requestId } },
        });
        if (previous.operationType !== 'collect_booking' || previous.payloadHash !== payloadHash || !previous.resultJson) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different request');
        }
        return { status: 200, body: previous.resultJson };
      }
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM app.bookings WHERE id = ${bookingId}::uuid
        AND owner_id = ${owner}::uuid FOR UPDATE`;
      if (!locked.length) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      const booking = await tx.booking.findFirstOrThrow({ where: { id: bookingId, ownerId: owner } });
      const entry = await tx.customerFundEntry.create({ data: {
        ownerId: owner, bookingId, entryType: 'receipt',
        amountPaise: BigInt(body.amount_paise), method: body.method,
        occurredAt: new Date(body.occurred_at), note: body.note ?? null,
        operationRequestId: requestId,
      } });
      const receipts = await tx.customerFundEntry.groupBy({ by: ['entryType'],
        where: { ownerId: owner, bookingId }, _sum: { amountPaise: true } });
      const amount = (kind: string) => receipts.find((row) => row.entryType === kind)?._sum.amountPaise ?? 0n;
      const collected = amount('receipt') + amount('collection_adjustment_increase') -
        amount('collection_adjustment_decrease') - amount('refund') - amount('reversal');
      const walletEntries = await tx.walletEntry.groupBy({ by: ['entryType'],
        where: { ownerId: owner, bookingId }, _sum: { amountPaise: true } });
      const walletAmount = (kind: string) => walletEntries.find((row) => row.entryType === kind)?._sum.amountPaise ?? 0n;
      const deducted = booking.recordedWalletDeductionPaise + walletAmount('booking_debit') -
        walletAmount('wallet_refund') - walletAmount('debit_reversal');
      const recorded = await tx.bookingDeductionEntry.groupBy({ by: ['entryType'], where: { ownerId: owner, bookingId },
        _sum: { amountPaise: true } });
      const recordedAmount = (kind: string) => recorded.find((row) => row.entryType === kind)?._sum.amountPaise ?? 0n;
      const totalDeducted = deducted + recordedAmount('booking_debit') - recordedAmount('deduction_adjustment_decrease');
      const payable = booking.ticketPricePaise + booking.serviceChargePaise;
      const signed = payable - collected;
      const resultJson = { entry: { id: entry.id, entry_type: entry.entryType,
        amount_paise: Number(entry.amountPaise), method: entry.method,
        occurred_at: entry.occurredAt.toISOString(), note: entry.note },
        financials: { total_payable_paise: Number(payable), collected_paise: Number(collected),
          wallet_deducted_paise: Number(totalDeducted),
          fund_balance_paise: Number(booking.ticketPricePaise - totalDeducted),
          signed_balance_paise: Number(signed),
          balance_due_paise: Number(signed > 0n ? signed : 0n),
          advance_credit_paise: Number(signed < 0n ? -signed : 0n) } };
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'booking', entityId: bookingId, action: 'collection', afterJson: resultJson } });
      await tx.operationRequest.update({ where: { ownerId_requestId: { ownerId: owner, requestId } },
        data: { resultJson, completedAt: new Date() } });
      return { status: 201, body: resultJson };
    });
    response.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

router.post('/:id/deductions', async (request, response, next) => {
  try {
    const bookingId = uuid.parse(request.params.id);
    const body = deductionBody.parse(request.body);
    const owner = response.locals.auth.userId as string;
    const requestId = operationId(request.header('Idempotency-Key'));
    const payloadHash = hash({ bookingId, ...body });
    const result = await getPrisma().$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO app.operation_requests (owner_id, request_id, operation_type, payload_hash)
        VALUES (${owner}::uuid, ${requestId}::uuid, 'record_booking_deduction', ${payloadHash})
        ON CONFLICT DO NOTHING`;
      if (!claimed) {
        const previous = await tx.operationRequest.findUniqueOrThrow({
          where: { ownerId_requestId: { ownerId: owner, requestId } },
        });
        if (previous.operationType !== 'record_booking_deduction' ||
            previous.payloadHash !== payloadHash || !previous.resultJson) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different request');
        }
        return { status: 200, body: previous.resultJson };
      }
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM app.bookings WHERE id = ${bookingId}::uuid
        AND owner_id = ${owner}::uuid FOR UPDATE`;
      if (!locked.length) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      const booking = await tx.booking.findFirstOrThrow({ where: { id: bookingId, ownerId: owner } });
      const entry = await tx.bookingDeductionEntry.create({ data: {
        ownerId: owner, bookingId, amountPaise: BigInt(body.amount_paise),
        occurredAt: new Date(body.occurred_at), note: body.note ?? null,
        operationRequestId: requestId,
      } });
      const resultJson = { entry: { id: entry.id, source: 'recorded_deduction',
        entry_type: 'booking_debit', amount_paise: Number(entry.amountPaise),
        occurred_at: entry.occurredAt.toISOString(), note: entry.note },
        financials: await bookingFinancials(booking, tx) };
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'booking', entityId: bookingId, action: 'record_deduction', afterJson: resultJson } });
      await tx.operationRequest.update({ where: { ownerId_requestId: { ownerId: owner, requestId } },
        data: { resultJson, completedAt: new Date() } });
      return { status: 201, body: resultJson };
    });
    response.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

router.get('/:id/entries', async (request, response, next) => {
  try {
    const bookingId = uuid.parse(request.params.id);
    const query = timelineQuery.parse(request.query);
    const owner = response.locals.auth.userId as string;
    const booking = await getPrisma().booking.findFirst({ where: { id: bookingId, ownerId: owner },
      select: { id: true, recordedWalletDeductionPaise: true, createdAt: true } });
    if (!booking) {
      throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    }
    const take = query.offset + query.limit + 1;
    const [customer, wallet, deductions] = await Promise.all([
      getPrisma().customerFundEntry.findMany({ where: { ownerId: owner, bookingId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take }),
      getPrisma().walletEntry.findMany({ where: { ownerId: owner, bookingId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take }),
      getPrisma().bookingDeductionEntry.findMany({ where: { ownerId: owner, bookingId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take }),
    ]);
    const items = [
      ...customer.map((entry) => ({ id: entry.id, source: 'customer', entry_type: entry.entryType,
        amount_paise: Number(entry.amountPaise), method: entry.method,
        original_entry_id: entry.reversalOfEntryId,
        occurred_at: entry.occurredAt.toISOString(), note: entry.note })),
      ...wallet.map((entry) => ({ id: entry.id, source: 'wallet', entry_type: entry.entryType,
        amount_paise: Number(entry.amountPaise), method: null,
        wallet_id: entry.walletId, original_entry_id: entry.reversalOfEntryId,
        occurred_at: entry.occurredAt.toISOString(), note: entry.note })),
      ...deductions.map((entry) => ({ id: entry.id, source: 'recorded_deduction',
        entry_type: entry.entryType, amount_paise: Number(entry.amountPaise), method: null,
        wallet_id: null, original_entry_id: null,
        occurred_at: entry.occurredAt.toISOString(), note: entry.note })),
      ...(booking.recordedWalletDeductionPaise > 0n ? [{ id: booking.id,
        source: 'recorded_deduction', entry_type: 'booking_debit',
        amount_paise: Number(booking.recordedWalletDeductionPaise), method: null,
        wallet_id: null, original_entry_id: null,
        occurred_at: booking.createdAt.toISOString(), note: null }] : []),
    ].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id));
    const page = items.slice(query.offset, query.offset + query.limit);
    response.json({ items: page, next_offset: items.length > query.offset + query.limit
      ? query.offset + query.limit : null });
  } catch (error) { next(error); }
});

router.get('/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const booking = await getPrisma().booking.findFirst({ where: {
      id, ownerId: response.locals.auth.userId,
    }, include: withLegs });
    if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    response.json({ booking: bookingJson(booking), financials: await bookingFinancials(booking) });
  } catch (error) { next(error); }
});

// Ticket tracking for one leg: status, PNR and the account it was bought from.
// Fares change through the booking edit so money corrections stay audited there.
router.patch('/:id/legs/:legId', async (request, response, next) => {
  try {
    const bookingId = uuid.parse(request.params.id);
    const legId = uuid.parse(request.params.legId);
    const body = legUpdateBody.parse(request.body);
    const owner = response.locals.auth.userId as string;
    const result = await getPrisma().$transaction(async (tx) => {
      // Cancelling changes what the booking bills, so lock it first.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM app.bookings WHERE id = ${bookingId}::uuid
        AND owner_id = ${owner}::uuid FOR UPDATE`;
      if (!locked.length) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      const before = await tx.bookingLeg.findFirst({ where: { id: legId, bookingId, ownerId: owner } });
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      if (body.booking_account_id && body.booking_account_id !== before.bookingAccountId) {
        await requireAccounts(tx, owner, [body.booking_account_id]);
      }
      const status = body.ticket_status ?? before.ticketStatus;
      if (status !== 'cancelled' && body.cancellation_charge_paise) {
        throw new ApiError(422, 'CHARGE_NEEDS_CANCELLED', 'Only a cancelled ticket can have a cancellation charge');
      }
      const after = await tx.bookingLeg.update({ where: { id: legId }, data: {
        ticketStatus: status,
        // Restoring a ticket clears its charge, because the fare counts again.
        cancellationChargePaise: status === 'cancelled'
          ? BigInt(body.cancellation_charge_paise ?? before.cancellationChargePaise) : 0n,
        ...(body.pnr !== undefined ? { pnr: body.pnr } : {}),
        ...(body.booking_account_id !== undefined ? { bookingAccountId: body.booking_account_id } : {}),
      } });
      const legs = await tx.bookingLeg.findMany({ where: { ownerId: owner, bookingId } });
      const billed = legs.reduce((total, leg) => total + (leg.ticketStatus === 'cancelled'
        ? leg.cancellationChargePaise : leg.farePaise), 0n);
      const beforeBooking = await tx.booking.findFirstOrThrow({ where: { id: bookingId, ownerId: owner } });
      const booking = billed === beforeBooking.ticketPricePaise ? beforeBooking
        : await tx.booking.update({ where: { id: bookingId }, data: { ticketPricePaise: billed } });
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'booking_leg', entityId: legId, action: 'track',
        beforeJson: { ...legJson(before), booking_ticket_price_paise: Number(beforeBooking.ticketPricePaise) },
        afterJson: { ...legJson(after), booking_ticket_price_paise: Number(booking.ticketPricePaise) } } });
      return { leg: legJson(after), financials: await bookingFinancials(booking, tx) };
    });
    response.json(result);
  } catch (error) { next(error); }
});

export { router as bookingRouter };
