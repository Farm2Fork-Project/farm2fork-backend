import { ShipmentStatus } from './schemas/shipment.schema';
/** A failed delivery still reserves its transporter while they hold the goods. */
export function activeDeliveryFilter() {
  return {
    $or: [
      {
        status: {
          $in: [
            ShipmentStatus.Assigned,
            ShipmentStatus.PickedUp,
            ShipmentStatus.InTransit,
          ],
        },
      },
      {
        status: ShipmentStatus.Failed,
        'issue.stage': {
          $in: [ShipmentStatus.PickedUp, ShipmentStatus.InTransit],
        },
        'issue.resolvedAt': { $exists: false },
      },
    ],
  };
}
