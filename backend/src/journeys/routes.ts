import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';
import { journeyRequestStatuses, type TicketType } from '../admin/rules.js';
import { quoteServiceCharge } from '../bookings/legs.js';
import { journeyRequestJson, transitionRequest } from './shared.js';

// The owner's side of journey requests: review, quote and decline. Booking a
// request happens through POST /bookings with journey_request_id, so it gets
// the same credit check and ledger entries as any other booking.
const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const paise = z.number().int().safe().min(0).max(1_000_000_000_000);
const listQuery = z.object({
  status: z.enum(journeyRequestStatuses).optional(),
  packager_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
const quoteBody = z.strictObject({
  ticket_price_paise: paise.positive(),
  // Omitted means the packager's service charge rule for the ticket type.
  service_charge_paise: paise.optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
const declineBody = z.strictObject({ reason: z.string().trim().min(1).max(2000) });

function ownerId(response: Response): string {
  return response.locals.auth.userId as string;
}
const withNames = { packager: { select: { name: true } },
  requestedBy: { select: { emailNormalized: true, displayName: true } } } as const;
type NamedRequest = Parameters<typeof journeyRequestJson>[0] & { packagerId: string;
  packager: { name: string }; requestedBy: { emailNormalized: string; displayName: string | null } };
function adminJson(request: NamedRequest) {
  return { ...journeyRequestJson(request), packager_id: request.packagerId, packager_name: request.packager.name,
    requested_by: { email: request.requestedBy.emailNormalized, display_name: request.requestedBy.displayName } };
}

router.get('/', async (request, response, next) => {
  try {
    const query = listQuery.parse(request.query);
    const requests = await getPrisma().journeyRequest.findMany({
      where: { ownerId: ownerId(response), ...(query.status ? { status: query.status } : {}),
        ...(query.packager_id ? { packagerId: query.packager_id } : {}) },
      include: withNames, orderBy: [{ journeyDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: query.offset, take: query.limit + 1,
    });
    const page = requests.slice(0, query.limit);
    response.json({ items: page.map(adminJson),
      next_offset: requests.length > query.limit ? query.offset + query.limit : null });
  } catch (error) { next(error); }
});

router.get('/:id', async (request, response, next) => {
  try {
    const journey = await getPrisma().journeyRequest.findFirst({
      where: { id: uuid.parse(request.params.id), ownerId: ownerId(response) }, include: withNames,
    });
    if (!journey) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    response.json({ journey_request: adminJson(journey) });
  } catch (error) { next(error); }
});

router.post('/:id/quote', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const body = quoteBody.parse(request.body);
    const owner = ownerId(response);
    const journey = await getPrisma().$transaction(async (tx) => {
      const current = await tx.journeyRequest.findFirst({ where: { id, ownerId: owner },
        select: { packagerId: true, ticketType: true } });
      const charge = body.service_charge_paise !== undefined || !current
        ? BigInt(body.service_charge_paise ?? 0)
        : await quoteServiceCharge(tx, owner, current.packagerId, current.ticketType as TicketType);
      const updated = await transitionRequest(tx, { id, ownerId: owner }, 'quote', {
        status: 'quoted', quotedTicketPricePaise: BigInt(body.ticket_price_paise),
        quotedServiceChargePaise: charge, quoteNote: body.note ?? null, quotedAt: new Date(),
      });
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'journey_request', entityId: id, action: 'quote', afterJson: journeyRequestJson(updated) } });
      return tx.journeyRequest.findUniqueOrThrow({ where: { id }, include: withNames });
    });
    response.json({ journey_request: adminJson(journey) });
  } catch (error) { next(error); }
});

router.post('/:id/decline', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const body = declineBody.parse(request.body);
    const owner = ownerId(response);
    const journey = await getPrisma().$transaction(async (tx) => {
      const updated = await transitionRequest(tx, { id, ownerId: owner }, 'decline', {
        status: 'declined', declineReason: body.reason });
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner, reason: body.reason,
        entityType: 'journey_request', entityId: id, action: 'decline', afterJson: journeyRequestJson(updated) } });
      return tx.journeyRequest.findUniqueOrThrow({ where: { id }, include: withNames });
    });
    response.json({ journey_request: adminJson(journey) });
  } catch (error) { next(error); }
});

export { router as journeyRequestRouter };
