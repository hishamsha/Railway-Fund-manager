import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';
import { pickServiceCharge, ticketTypes } from '../admin/rules.js';

// Service charge per ticket type. A rule with no packager is the default;
// a packager rule overrides it for that agency.
const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const paise = z.number().int().safe().min(0).max(1_000_000_000_000);
const upsertBody = z.strictObject({
  packager_id: uuid.nullable(),
  ticket_type: z.enum(ticketTypes),
  charge_paise: paise,
});
const listQuery = z.object({ packager_id: uuid.optional() });
const quoteQuery = z.object({ packager_id: uuid, ticket_type: z.enum(ticketTypes) });

type RuleRow = { id: string; packager_id: string | null; ticket_type: string;
  charge_paise: bigint; created_at: Date; updated_at: Date };

function ownerId(response: Response): string {
  return response.locals.auth.userId as string;
}
function serialize(rule: { id: string; packagerId: string | null; ticketType: string;
  chargePaise: bigint; createdAt: Date; updatedAt: Date }) {
  return { id: rule.id, packager_id: rule.packagerId, ticket_type: rule.ticketType,
    charge_paise: Number(rule.chargePaise),
    created_at: rule.createdAt.toISOString(), updated_at: rule.updatedAt.toISOString() };
}
async function requirePackager(owner: string, packagerId: string) {
  const packager = await getPrisma().packager.findFirst({ where: { id: packagerId, ownerId: owner },
    select: { id: true } });
  if (!packager) throw new ApiError(404, 'NOT_FOUND', 'Packager not found');
}

router.get('/', async (request, response, next) => {
  try {
    const query = listQuery.parse(request.query);
    const rules = await getPrisma().serviceChargeRule.findMany({
      where: { ownerId: ownerId(response),
        ...(query.packager_id ? { OR: [{ packagerId: query.packager_id }, { packagerId: null }] } : {}) },
      orderBy: [{ packagerId: { sort: 'asc', nulls: 'first' } }, { ticketType: 'asc' }],
    });
    response.json({ items: rules.map(serialize) });
  } catch (error) { next(error); }
});

router.get('/quote', async (request, response, next) => {
  try {
    const query = quoteQuery.parse(request.query);
    const owner = ownerId(response);
    await requirePackager(owner, query.packager_id);
    const rules = await getPrisma().serviceChargeRule.findMany({ where: { ownerId: owner,
      ticketType: query.ticket_type, OR: [{ packagerId: query.packager_id }, { packagerId: null }] } });
    const quote = pickServiceCharge(rules, query.packager_id, query.ticket_type);
    response.json({ packager_id: query.packager_id, ticket_type: query.ticket_type,
      charge_paise: Number(quote.charge_paise), source: quote.source });
  } catch (error) { next(error); }
});

router.put('/', async (request, response, next) => {
  try {
    const body = upsertBody.parse(request.body);
    const owner = ownerId(response);
    if (body.packager_id) await requirePackager(owner, body.packager_id);
    const rule = await getPrisma().$transaction(async (tx) => {
      const before = await tx.serviceChargeRule.findFirst({ where: { ownerId: owner,
        packagerId: body.packager_id, ticketType: body.ticket_type } });
      const rows = await tx.$queryRaw<RuleRow[]>`
        INSERT INTO app.service_charge_rules (id, owner_id, packager_id, ticket_type, charge_paise, updated_at)
        VALUES (gen_random_uuid(), ${owner}::uuid, ${body.packager_id}::uuid, ${body.ticket_type},
          ${BigInt(body.charge_paise)}, now())
        ON CONFLICT (owner_id, packager_id, ticket_type)
        DO UPDATE SET charge_paise = EXCLUDED.charge_paise, updated_at = now()
        RETURNING id, packager_id, ticket_type, charge_paise, created_at, updated_at`;
      const row = rows[0]!;
      const saved = { id: row.id, packagerId: row.packager_id, ticketType: row.ticket_type,
        chargePaise: BigInt(row.charge_paise), createdAt: row.created_at, updatedAt: row.updated_at };
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'service_charge_rule', entityId: saved.id, action: before ? 'update' : 'create',
        beforeJson: before ? serialize(before) : undefined, afterJson: serialize(saved) } });
      return { saved, created: !before };
    });
    response.status(rule.created ? 201 : 200).json({ rule: serialize(rule.saved) });
  } catch (error) { next(error); }
});

router.delete('/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const owner = ownerId(response);
    await getPrisma().$transaction(async (tx) => {
      const rule = await tx.serviceChargeRule.findFirst({ where: { id, ownerId: owner } });
      if (!rule) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      await tx.serviceChargeRule.delete({ where: { id } });
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'service_charge_rule', entityId: id, action: 'delete', beforeJson: serialize(rule) } });
    });
    response.status(204).end();
  } catch (error) { next(error); }
});

export { router as serviceChargeRuleRouter };
