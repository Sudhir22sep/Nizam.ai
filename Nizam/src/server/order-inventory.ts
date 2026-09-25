import { Collection, ObjectId } from 'mongodb';

export interface InventoryLine {
  productId: ObjectId;
  quantity: number;
}

export type InventoryResult =
  | { ok: true }
  | { ok: false; message: string };

export function normalizeInventoryQuantity(value: unknown): number | null {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

export function reservationKey(orderReference: string): string {
  if (!/^ORDER-[A-Za-z0-9-]+$/.test(orderReference)) {
    throw new Error('Invalid order reference for inventory reservation.');
  }
  return orderReference;
}

/** Adds tracked Mongo product lines from authoritative pricing results. */
export function inventoryLinesFromPricedItems(items: Array<{
  productId?: ObjectId;
  stockTracked?: boolean;
  quantity: number;
}>): InventoryLine[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!item.stockTracked || !item.productId) continue;
    const key = item.productId.toString();
    quantities.set(key, (quantities.get(key) ?? 0) + item.quantity);
  }
  return Array.from(quantities, ([id, quantity]) => ({ productId: new ObjectId(id), quantity }));
}

export async function reserveInventory(
  products: Collection<any>,
  orderReference: string,
  lines: InventoryLine[]
): Promise<InventoryResult> {
  if (lines.length === 0) return { ok: true };
  const key = reservationKey(orderReference);
  const reserved: InventoryLine[] = [];

  for (const line of lines) {
    const result = await products.findOneAndUpdate(
      {
        _id: line.productId,
        isActive: { $ne: false },
        $expr: { $gte: ['$stock', { $add: [{ $ifNull: ['$reservedStock', 0] }, line.quantity] }] },
      },
      {
        $inc: { reservedStock: line.quantity },
        $set: { [`inventoryReservations.${key}`]: line.quantity, updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
    if (!result) {
      await releaseInventory(products, orderReference, reserved);
      return { ok: false, message: 'One or more items do not have enough stock. Please update your cart.' };
    }
    reserved.push(line);
  }
  return { ok: true };
}

export async function consumeInventory(
  products: Collection<any>,
  orderReference: string,
  lines: InventoryLine[]
): Promise<InventoryResult> {
  return transitionInventory(products, orderReference, lines, 'consume');
}

export async function releaseInventory(
  products: Collection<any>,
  orderReference: string,
  lines: InventoryLine[]
): Promise<InventoryResult> {
  return transitionInventory(products, orderReference, lines, 'release');
}

async function transitionInventory(
  products: Collection<any>,
  orderReference: string,
  lines: InventoryLine[],
  transition: 'consume' | 'release'
): Promise<InventoryResult> {
  if (lines.length === 0) return { ok: true };
  const key = reservationKey(orderReference);

  for (const line of lines) {
    const reservationPath = `inventoryReservations.${key}`;
    const result = await products.findOneAndUpdate(
      { _id: line.productId, [reservationPath]: line.quantity },
      transition === 'consume'
        ? {
            $inc: { stock: -line.quantity, reservedStock: -line.quantity },
            $unset: { [reservationPath]: '' },
            $set: { updatedAt: new Date() },
          }
        : {
            $inc: { reservedStock: -line.quantity },
            $unset: { [reservationPath]: '' },
            $set: { updatedAt: new Date() },
          },
      { returnDocument: 'after' }
    );
    // Missing means another idempotent retry already completed this line.
    if (!result) continue;
  }
  return { ok: true };
}
